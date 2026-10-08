import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-telegram-bot-api-secret-token","Content-Type":"application/json"};
function out(d:unknown,s=200){return new Response(JSON.stringify(d),{status:s,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-telegram-bot-api-secret-token","Content-Type":"application/json"}})}
function b64u(bytes:Uint8Array){let x="";for(const b of bytes)x+=String.fromCharCode(b);return btoa(x).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function hash(v:string){return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))))}
async function tg(method:string,payload:Record<string,unknown>){const token=Deno.env.get("TELEGRAM_BOT_TOKEN");if(!token)throw new Error("TELEGRAM_BOT_TOKEN is not configured.");const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok!==true)throw new Error(d?.description||"Telegram API request failed.");return d}
function cleanTelegramText(text:string){
  return String(text||"")
    .replace(/\\+r\\+n/g,"\n")
    .replace(/\\+n/g,"\n")
    .replace(/\/n/g,"\n")
    .replace(/'n/g,"\n")
    .replace(/[ \t]+\n/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}
const canonicalNetworkLabel=(code:string,name?:string)=>String(code||"").toLowerCase()==="9mobile"?"9mobile (T2)":(name||String(code||"")).trim();
const networkKeyboard={keyboard:[
  [{text:"MTN"},{text:"Airtel"}],
  [{text:"Glo"},{text:"9mobile (T2)"}],
  [{text:"↩️ Main Menu"}]
],resize_keyboard:true,is_persistent:false};
const menuKeyboard={keyboard:[
  [{text:"📦 Buy Data"},{text:"📱 Airtime"}],
  [{text:"🔄 Buy Again"},{text:"🧾 Bills"}],
  [{text:"💰 Wallet"},{text:"➕ Fund Wallet"}],
  [{text:"💳 Wallet History"},{text:"🧾 Transactions"}],
  [{text:"👥 Saved Numbers"}],
  [{text:"👤 My Account"},{text:"💬 Ask AI"}]
],resize_keyboard:true,is_persistent:true};
const savedNumbersKeyboard={keyboard:[
  [{text:"➕ Add Saved Number"},{text:"🗑️ Delete Saved Number"}],
  [{text:"📋 My Saved Numbers"}],
  [{text:"↩️ Main Menu"}]
],resize_keyboard:true,is_persistent:false};
async function send(chatId:number,text:string,showMenu=false,replyMarkup?:Record<string,unknown>){return tg("sendMessage",{chat_id:chatId,text:cleanTelegramText(text).slice(0,4096),disable_web_page_preview:true,...(replyMarkup?{reply_markup:replyMarkup}:(showMenu?{reply_markup:menuKeyboard}:{}))})}
async function claimTelegramNotification(db:any,transactionId:string){
  const now=new Date();
  const stale=new Date(now.getTime()-10*60*1000).toISOString();
  const {data,error}=await db.from("transactions")
    .select("notification_attempts,status,source")
    .eq("id",transactionId)
    .eq("source","telegram")
    .in("status",["successful","failed","reversed"])
    .is("customer_notified_at",null)
    .or("notification_claimed_at.is.null,notification_claimed_at.lt."+stale)
    .maybeSingle();
  if(error) throw error;
  if(!data) return null;
  const attempts=Number(data.notification_attempts||0);
  const {data:claimed,error:claimError}=await db.from("transactions")
    .update({
      notification_claimed_at:now.toISOString(),
      notification_attempts:attempts+1
    })
    .eq("id",transactionId)
    .eq("source","telegram")
    .in("status",["successful","failed","reversed"])
    .is("customer_notified_at",null)
    .eq("notification_attempts",attempts)
    .or("notification_claimed_at.is.null,notification_claimed_at.lt."+stale)
    .select("notification_attempts")
    .maybeSingle();
  if(claimError) throw claimError;
  return claimed||null;
}
async function completeTelegramNotification(db:any,transactionId:string){
  const {error}=await db.from("transactions").update({
    customer_notified_at:new Date().toISOString(),
    notification_claimed_at:null,
    last_notification_error:null
  }).eq("id",transactionId).eq("source","telegram").is("customer_notified_at",null);
  if(error) throw error;
}
async function releaseTelegramNotificationClaim(db:any,transactionId:string,errorMessage:string){
  await db.from("transactions").update({
    notification_claimed_at:null,
    last_notification_error:errorMessage
  }).eq("id",transactionId).eq("source","telegram").is("customer_notified_at",null);
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"Access-Control-Allow-Origin":"*"}});
 try{
  const expected=Deno.env.get("TELEGRAM_WEBHOOK_SECRET"); if(!expected||req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==expected)return out({success:false,error:"Unauthorized webhook."},401);
  const update=await req.json();
  const callback=update?.callback_query;
  let m=update?.message;
  if(callback?.message?.chat?.id&&callback?.from?.id){
    await tg("answerCallbackQuery",{callback_query_id:String(callback.id)});
    // Only the receipt's Buy Again button is acted on; every other callback stays ignored.
    if(String(callback.data||"")!=="receipt_buy_again")return out({success:true,ignored:true});
    m={chat:callback.message.chat,from:callback.from,text:"🔄 Buy Again"};
  }
  if(!m?.chat?.id||!m?.from?.id||typeof m?.text!=="string")return out({success:true,ignored:true});
  if(m.chat.type!=="private"){await send(Number(m.chat.id),"Bindawasub AI is currently available in private Telegram chats.");return out({success:true})}
  const chatId=Number(m.chat.id),tgUserId=Number(m.from.id),text=String(m.text).trim(),username=m.from.username?String(m.from.username):null,firstName=m.from.first_name?String(m.from.first_name):null;
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const start=text.match(/^\/start(?:\s+(.+))?$/i);
  if(start){
   const code=start?.[1]?.trim();
   if(!code){
    const {data:existingTelegram,error:existingTelegramError}=await db.from("telegram_accounts").select("id,user_id,active").eq("telegram_user_id",tgUserId).maybeSingle();
    if(existingTelegramError) throw existingTelegramError;
    if(existingTelegram?.active){
     const now=new Date().toISOString();
     const {error:e}=await db.from("telegram_accounts").update({telegram_chat_id:chatId,telegram_username:username,first_name:firstName,last_seen_at:now,active:true}).eq("id",existingTelegram.id);
     if(e) throw e;
     await db.from("wallets").upsert({user_id:existingTelegram.user_id,currency:"NGN",updated_at:now},{onConflict:"user_id",ignoreDuplicates:true});
     await db.from("telegram_conversation_states").upsert({telegram_chat_id:chatId,user_id:existingTelegram.user_id,state:"idle",context:{},updated_at:now},{onConflict:"telegram_chat_id"});
     await send(chatId,"Sannu, "+String(firstName||"aboki")+"! 👋\n\nWelcome back to Bindawasub AI.",true);
     return out({success:true,telegram_user_id:tgUserId,user_id:existingTelegram.user_id,linked:true,new_user:false});
    }
    const syntheticPhone="telegram:"+String(tgUserId);
    let {data:newUser,error:newUserError}=await db.from("users").select("id").eq("phone",syntheticPhone).maybeSingle();
    if(newUserError) throw newUserError;
    if(!newUser){
     const {data:created,error:e}=await db.from("users").insert({phone:syntheticPhone,name:firstName||"Telegram Customer",role:"customer",language:"english",last_active_at:new Date().toISOString()}).select("id").single();
     if(e){ if(String(e.code||"")==="23505"){ const retry=await db.from("users").select("id").eq("phone",syntheticPhone).maybeSingle(); if(retry.error) throw retry.error; newUser=retry.data; } else throw e; } else newUser=created;
    }
    if(!newUser?.id) throw new Error("Unable to create Telegram customer.");
    const now=new Date().toISOString();
    const {error:we}=await db.from("wallets").upsert({user_id:newUser.id,currency:"NGN",updated_at:now},{onConflict:"user_id",ignoreDuplicates:true}); if(we) throw we;
    const {data:ta,error:te}=await db.from("telegram_accounts").upsert({user_id:newUser.id,telegram_user_id:tgUserId,telegram_chat_id:chatId,telegram_username:username,first_name:firstName,active:true,linked_at:now,last_seen_at:now},{onConflict:"telegram_user_id"}).select("id,user_id,active").single(); if(te) throw te;
    const {error:se}=await db.from("telegram_conversation_states").upsert({telegram_chat_id:chatId,user_id:newUser.id,state:"idle",context:{},updated_at:now},{onConflict:"telegram_chat_id"}); if(se) throw se;
    await send(chatId,"Sannu, "+String(firstName||"aboki")+"! 👋\n\nYour Bindawasub AI account has been created automatically.\n\nNo web registration is required.\n\nUse the menu below to buy data, airtime, fund your wallet, view transactions, or ask AI.",true);
    return out({success:true,telegram_user_id:tgUserId,user_id:ta.user_id,linked:true,new_user:true});
   }
   const {data:lc,error:le}=await db.from("telegram_link_codes").select("id,user_id,expires_at,used_at").eq("code_hash",await hash(code)).maybeSingle(); if(le)throw le;
   if(!lc||lc.used_at||new Date(lc.expires_at).getTime()<=Date.now()){await send(chatId,"That Telegram link code is invalid or expired. Please create a new one.");return out({success:true})}
   const {data:existing,error:ee}=await db.from("telegram_accounts").select("id,user_id").eq("telegram_user_id",tgUserId).maybeSingle();if(ee)throw ee;
   if(existing&&existing.user_id!==lc.user_id){await send(chatId,"This Telegram account is already linked to another Bindawasub account.");return out({success:true})}
   const {error:ue}=await db.from("telegram_accounts").upsert({user_id:lc.user_id,telegram_user_id:tgUserId,telegram_chat_id:chatId,telegram_username:username,first_name:firstName,active:true,last_seen_at:new Date().toISOString(),linked_at:new Date().toISOString()},{onConflict:"telegram_user_id"});if(ue)throw ue;
   const {error:ce}=await db.from("telegram_link_codes").update({used_at:new Date().toISOString()}).eq("id",lc.id).is("used_at",null);if(ce)throw ce;
   await send(chatId,"✅ Your Bindawasub account is connected.\n\nUse the menu below for quick actions, or type any request naturally.\n\nExamples:\nbuy 1GB for 080...\ncheck my balance\nshow data plans",true);
   return out({success:true,linked:true});
  }
  const {data:acct,error:ae}=await db.from("telegram_accounts").select("user_id,active").eq("telegram_chat_id",chatId).eq("telegram_user_id",tgUserId).maybeSingle();if(ae)throw ae;
  if(!acct?.active){await send(chatId,"Your Telegram account is not linked yet. Generate a Telegram link code from your Bindawasub account and use the /start link.");return out({success:true,linked:false})}
  await db.from("telegram_accounts").update({telegram_username:username,first_name:firstName,last_seen_at:new Date().toISOString()}).eq("telegram_chat_id",chatId).eq("telegram_user_id",tgUserId);
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/bindawasub-ai",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const {data:tgState}=await db.from("telegram_conversation_states").select("state,context,updated_at").eq("telegram_chat_id",chatId).maybeSingle();
  let state=String(tgState?.state||"idle"); let context=(tgState?.context&&typeof tgState?.context==="object")?tgState.context:{};
  const saveState=async(nextState:string,nextContext:any={})=>{state=nextState;context=nextContext;await db.from("telegram_conversation_states").upsert({telegram_chat_id:chatId,user_id:acct.user_id,state:nextState,context:nextContext,updated_at:new Date().toISOString()},{onConflict:"telegram_chat_id"});};
  const clearState=async()=>saveState("idle",{});
  // Single recommendation route. Keep detection deterministic and avoid regex word-boundary escaping issues.
  const recText=String(text||"").trim().toLowerCase();
  const recHasWord=["best","better","recommend","recommendation","suggest","suggestion","cheapest","cheap","most","maximum","max","affordable"].some((w)=>recText.includes(w));
  const recHasData=["data","internet","plan","plans","gb","package","packages"].some((w)=>recText.includes(w));
  const recLooksLikeRecommendation=recHasWord&&recHasData;
  if(recLooksLikeRecommendation){
    const ai=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},
      body:JSON.stringify({user_id:acct.user_id,channel:"telegram",message:text})
    });
    const d=await ai.json().catch(()=>({}));
    if(!ai.ok || String(d?.intent||"").toLowerCase()!=="budget_recommendation"){
      await clearState();
      await send(chatId,"I couldn't build a reliable recommendation right now. Please try again with a request like: Best data for ₦500.",true);
      return out({success:false,linked:true,state:"idle",intent:"budget_recommendation",error:d?.error||"Recommendation engine did not return a recommendation."});
    }
    const recs=Array.isArray(d?.recommendations)?d.recommendations:(Array.isArray(d?.products)?d.products:[]);
    if(!recs.length){
      await clearState();
      await send(chatId,String(d?.answer||"I couldn't find an active data plan you can afford right now."),true);
      return out({success:true,linked:true,state:"idle",intent:"budget_recommendation",recommendations:[]});
    }
    const selectedRecs=recs.slice(0,3);
    const lines=selectedRecs.map((p:any,i:number)=>{
      const network=p.network_name||p.network||"";
      const duration=p.duration||(p.validity_type==="fixed"&&p.validity_value&&p.validity_unit?String(p.validity_value)+" "+p.validity_unit:p.validity_type==="unlimited"?"Unlimited":"");
      const details=[network,p.volume,duration].filter(Boolean).join(" • ");
      return (i+1)+". "+(p.product_name||"Data plan")+" — ₦"+Number(p.selling_price||0).toLocaleString("en-NG")+(details?"\n   "+details:"");
    });
    await saveState("awaiting_recommendation_selection",{recommendations:selectedRecs,products:selectedRecs});
    await send(chatId,String(d?.answer||"Here are the best options for you.")+"\n\n📦 Recommendations\n\n"+lines.join("\n\n")+"\n\nChoose 1, 2 or 3 to continue.",false,{keyboard:[[{text:"1"},{text:"2"},{text:"3"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_recommendation_selection",intent:"budget_recommendation",recommendations:selectedRecs,recommendation_strategy:d?.recommendation_strategy||null,recommendation_network:d?.recommendation_network||null});
  }

  // Recommendation selection must be handled before every other state/menu branch.
  if(state==="awaiting_recommendation_selection"){
    const selectionText=String(text||"").trim();
    if(/^(cancel|stop|quit|no|never mind|forget it)$/i.test(selectionText) || selectionText==="↩️ Main Menu"){
      await clearState();
      await send(chatId,"Recommendation cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }
    // Accept normal Telegram keyboard values plus common variants such as "Option 1", "1.", or emoji-number buttons.
    const normalizedSelection=selectionText
      .replace(/[\uFE0F\u20E3\uFE0F]/g,"")
      .replace(/^\s*(?:option|choice)\s*/i,"")
      .replace(/[.)\-:]\s*$/,"")
      .trim();
    const selectionMatch=normalizedSelection.match(/^([1-3])$/);
    if(selectionMatch){
      const index=Number(selectionMatch[1])-1;
      const recs=Array.isArray(context?.recommendations)
        ? context.recommendations
        : (Array.isArray(context?.products)?context.products:[]);
      const selected=recs[index];
      if(selected){
        await saveState("awaiting_data_recipient",{
          product_id:selected.product_id||selected.id,
          product_name:selected.product_name,
          network_code:selected.network_code||selected.network||"",
          network_name:selected.network_name||selected.network||"",
          volume:selected.volume||"",
          price:Number(selected.selling_price||0),
          variant_name:selected.variant_name||selected.variant||"",
          validity_type:selected.validity_type||"",
          validity_value:selected.validity_value??null,
          validity_unit:selected.validity_unit||""
        });
        await send(chatId,"Selected: "+String(selected.product_name||selected.volume||"Data plan")+" — ₦"+Number(selected.selling_price||0).toLocaleString("en-NG")+"\\n\\nWho should receive it? Send the recipient phone number (e.g. 08012345678).",false,{keyboard:[[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
        return out({success:true,linked:true,state:"awaiting_data_recipient",product:selected});
      }
    }
    await send(chatId,"Please choose 1, 2 or 3.",false,{keyboard:[[{text:"1"},{text:"2"},{text:"3"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_recommendation_selection"});
  }
  const lowWalletThreshold=1000;
  const criticalWalletThreshold=500;
  const walletWarning=(balance:number)=>balance<criticalWalletThreshold?"⚠️ Your wallet balance is ₦"+balance.toLocaleString("en-NG")+". You may need to fund your wallet before your next purchase.":balance<lowWalletThreshold?"⚠️ Your wallet balance is ₦"+balance.toLocaleString("en-NG")+". Consider funding your wallet before your next purchase.":"";
  const cancelRequest=/^(cancel|stop|quit|no|never mind|forget it|a'a|a'a ba)$/i.test(text);
  if(text==="↩️ Main Menu"){
    await clearState();
    await send(chatId,"Returned to the main menu. What would you like to do next?",true);
    return out({success:true,linked:true,state:"idle",menu_reset:true});
  }
  const fundingIntent=/\b(fund|funding|deposit|top ?up|add money|add funds|wallet funding|fund wallet|bank details|account details)\b/i.test(text);
  const amountMatch=String(text||"").trim().match(/^(?:₦\s*|NGN\s*|naira\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/i);
  const menuMap:Record<string,string>={"📦 Buy Data":"show data plans","📱 Airtime":"buy airtime","🧾 Bills":"pay bills","💰 Wallet":"check my wallet balance","➕ Fund Wallet":"fund wallet","🧾 Transactions":"show my recent transactions","👥 Saved Numbers":"saved numbers","👤 My Account":"show my account","💬 Ask AI":"Hello","🔄 Buy Again":"buy again"};
  const mapped=menuMap[text]; 
  let effectiveText=mapped||text;
  // Saved beneficiaries: menu-driven add/list/delete plus text commands and AI name resolution.
  const saveMatch=text.match(/^save\s+(?:number\s+)?(.+?)\s+(0[789]\d{9})$/i);
  const deleteMatch=text.match(/^(?:delete|remove)\s+(?:saved\s+)?(?:number\s+)?(.+)$/i);
  const listBeneficiaries=/^(?:saved numbers|saved beneficiaries|my saved numbers|list saved numbers|beneficiaries)$/i.test(text.trim());

  const normalizeBeneficiaryName=(value:string)=>String(value||"").trim().replace(/\s+/g," ");
  const maskPhone=(value:string)=>{
    const digits=String(value||"").replace(/\D/g,"");
    return digits.length>=7?digits.slice(0,4)+"****"+digits.slice(-3):String(value||"—");
  };

  if(text==="👥 Saved Numbers"){
    await saveState("saved_numbers_menu",{});
    await send(chatId,"👥 Saved Numbers\n\nChoose an option below:",false,savedNumbersKeyboard);
    return out({success:true,linked:true,state:"saved_numbers_menu"});
  }

  if(text==="➕ Add Saved Number"){
    await saveState("awaiting_saved_number_add",{});
    await send(chatId,"➕ Add Saved Number\n\nSend the name and phone number in this format:\n\nMum 08012345678\n\nExample: Brother 08123456789\n\nYou can also cancel.",false,{keyboard:[[{text:"❌ Cancel"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_saved_number_add"});
  }

  if(text==="🗑️ Delete Saved Number"){
    const {data:beneficiaries,error:beneficiaryError}=await db.from("saved_beneficiaries").select("name,phone_number").eq("user_id",acct.user_id).order("name",{ascending:true});
    if(beneficiaryError) throw beneficiaryError;
    if(!beneficiaries?.length){
      await send(chatId,"🗑️ Delete Saved Number\n\nYou do not have any saved numbers yet.",false,savedNumbersKeyboard);
      return out({success:true,linked:true,state:"saved_numbers_menu"});
    }
    const keyboard=(beneficiaries||[]).map((b:any)=>[{text:"🗑️ "+String(b.name)}]).concat([[{text:"↩️ Saved Numbers"}],[{text:"↩️ Main Menu"}]]);
    await saveState("awaiting_saved_number_delete",{});
    await send(chatId,"🗑️ Delete Saved Number\n\nSelect the saved number you want to remove:",false,{keyboard,resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_saved_number_delete"});
  }

  if(text==="📋 My Saved Numbers"){
    const {data:beneficiaries,error:beneficiaryError}=await db.from("saved_beneficiaries").select("name,phone_number").eq("user_id",acct.user_id).order("name",{ascending:true});
    if(beneficiaryError) throw beneficiaryError;
    if(!beneficiaries?.length){
      await send(chatId,"📋 My Saved Numbers\n\nYou have no saved numbers yet.\n\nTap ➕ Add Saved Number to add one.",false,savedNumbersKeyboard);
    }else{
      const lines=(beneficiaries||[]).map((b:any)=>"• "+String(b.name)+" — "+maskPhone(String(b.phone_number)));
      await send(chatId,"📋 My Saved Numbers\n\n"+lines.join("\n")+"\n\nTo use one, say: Buy 2GB MTN for Mum",false,savedNumbersKeyboard);
    }
    return out({success:true,linked:true,state:"saved_numbers_menu"});
  }

  if(state==="saved_numbers_menu" && (text==="↩️ Saved Numbers" || text==="saved numbers")){
    await send(chatId,"👥 Saved Numbers\n\nChoose an option below:",false,savedNumbersKeyboard);
    return out({success:true,linked:true,state:"saved_numbers_menu"});
  }

  if(state==="awaiting_saved_number_add"){
    if(cancelRequest || text==="❌ Cancel" || text==="↩️ Main Menu"){
      await clearState();
      await send(chatId,"Saved number addition cancelled.",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const addInput=String(text||"").trim().replace(/\s+/g," ");
    const addMatch=addInput.match(/^(.+?)\s+(0[789]\d{9})$/);
    if(!addMatch){
      await send(chatId,"❌ I couldn't read that.\n\nPlease send it like:\nMum 08012345678",false,{keyboard:[[{text:"❌ Cancel"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_saved_number_add"});
    }
    const beneficiaryName=normalizeBeneficiaryName(addMatch[1]);
    const beneficiaryPhone=String(addMatch[2]).trim();
    if(beneficiaryName.length<2 || beneficiaryName.length>40){
      await send(chatId,"Please use a name between 2 and 40 characters.\n\nExample: Mum 08012345678",false,{keyboard:[[{text:"❌ Cancel"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_saved_number_add"});
    }
    const {data:existing,error:existingError}=await db.from("saved_beneficiaries").select("id,name,phone_number").eq("user_id",acct.user_id).ilike("name",beneficiaryName).maybeSingle();
    if(existingError) throw existingError;
    const payload={user_id:acct.user_id,name:beneficiaryName,phone_number:beneficiaryPhone,updated_at:new Date().toISOString()};
    const saveResult=existing
      ? await db.from("saved_beneficiaries").update(payload).eq("id",existing.id)
      : await db.from("saved_beneficiaries").insert(payload);
    if(saveResult.error) throw saveResult.error;
    await clearState();
    await send(chatId,(existing?"✏️ Updated saved number.":"✅ Saved successfully.")+"\n\n"+beneficiaryName+" → "+maskPhone(beneficiaryPhone)+"\n\nYou can now say: buy data for "+beneficiaryName+".",true);
    return out({success:true,linked:true,state:"idle",saved:true,updated:!!existing});
  }

  if(state==="awaiting_saved_number_delete"){
    if(cancelRequest || text==="❌ Cancel" || text==="↩️ Main Menu"){
      await clearState();
      await send(chatId,"Saved-number deletion cancelled.",true);
      return out({success:true,linked:true,state:"idle"});
    }
    if(text==="↩️ Saved Numbers"){
      await saveState("saved_numbers_menu",{});
      await send(chatId,"👥 Saved Numbers\n\nChoose an option below:",false,savedNumbersKeyboard);
      return out({success:true,linked:true,state:"saved_numbers_menu"});
    }
    const selectedName=normalizeBeneficiaryName(text.replace(/^🗑️\s*/,""));
    const {data:deleted,error:deleteError}=await db.from("saved_beneficiaries").delete().eq("user_id",acct.user_id).ilike("name",selectedName).select("name").maybeSingle();
    if(deleteError) throw deleteError;
    await clearState();
    if(!deleted){
      await send(chatId,"I couldn't find a saved number named "+selectedName+".",true);
    }else{
      await send(chatId,"🗑️ Removed "+String(deleted.name)+" from your saved numbers.",true);
    }
    return out({success:true,linked:true,state:"idle",deleted:!!deleted});
  }

  if(saveMatch){
    const beneficiaryName=normalizeBeneficiaryName(saveMatch[1]);
    const beneficiaryPhone=String(saveMatch[2]).trim();
    if(beneficiaryName.length<2 || beneficiaryName.length>40){
      await send(chatId,"Please use a simple name, for example: save Mum 08012345678",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const {data:existing,error:existingError}=await db.from("saved_beneficiaries").select("id").eq("user_id",acct.user_id).ilike("name",beneficiaryName).maybeSingle();
    if(existingError) throw existingError;
    const payload={user_id:acct.user_id,name:beneficiaryName,phone_number:beneficiaryPhone,updated_at:new Date().toISOString()};
    const saveResult=existing
      ? await db.from("saved_beneficiaries").update(payload).eq("id",existing.id)
      : await db.from("saved_beneficiaries").insert(payload);
    if(saveResult.error) throw saveResult.error;
    await send(chatId,(existing?"✏️ Updated saved number.":"✅ Saved successfully.")+"\n\n"+beneficiaryName+" → "+maskPhone(beneficiaryPhone)+"\n\nYou can now say: buy data for "+beneficiaryName+".",true);
    return out({success:true,linked:true,state:"idle"});
  }

  if(deleteMatch){
    const beneficiaryName=normalizeBeneficiaryName(deleteMatch[1]);
    const {data:deleted,error:deleteError}=await db.from("saved_beneficiaries").delete().eq("user_id",acct.user_id).ilike("name",beneficiaryName).select("name").maybeSingle();
    if(deleteError) throw deleteError;
    if(!deleted){
      await send(chatId,"I couldn't find a saved number named "+beneficiaryName+".",true);
    }else{
      await send(chatId,"🗑️ Removed "+String(deleted.name)+" from your saved numbers.",true);
    }
    return out({success:true,linked:true,state:"idle"});
  }

  if(listBeneficiaries){
    const {data:beneficiaries,error:beneficiaryError}=await db.from("saved_beneficiaries").select("name,phone_number").eq("user_id",acct.user_id).order("name",{ascending:true});
    if(beneficiaryError) throw beneficiaryError;
    if(!beneficiaries?.length){
      await send(chatId,"📋 My Saved Numbers\n\nYou have no saved numbers yet.\n\nTap ➕ Add Saved Number to add one.",false,savedNumbersKeyboard);
    }else{
      const lines=beneficiaries.map((b:any)=>"• "+String(b.name)+" — "+maskPhone(String(b.phone_number)));
      await send(chatId,"📋 My Saved Numbers\n\n"+lines.join("\n")+"\n\nTo use one, say: Buy 2GB MTN for Mum",false,savedNumbersKeyboard);
    }
    return out({success:true,linked:true,state:"saved_numbers_menu"});
  }

  const networkMap:Record<string,string>={
    "mtn":"mtn",
    "airtel":"airtel",
    "glo":"glo",
    "t2":"9mobile",
    "9mobile":"9mobile",
    "9mobile (t2)":"9mobile"
  };
  const selectedNetworkCode=networkMap[String(text||"").trim().toLowerCase()]||null;

  const normalizedCommand=String(text||"").trim().replace(/^↩️\s*/,"").trim().toLowerCase();
  if(normalizedCommand==="main menu" || normalizedCommand==="return" || normalizedCommand==="home"){
    await clearState();
    await send(chatId,"What would you like to do next?",true);
    return out({success:true,linked:true,state:"idle"});
  }

  // Top-level menu buttons always start their own flow, even if a previous flow is still open.
  if(text==="🧾 Bills" && state!=="idle"){await clearState();state="idle";context={};}
  if(text==="📱 Airtime" && state!=="idle"){await clearState();state="idle";context={};}
  if(text==="📦 Buy Data" && state!=="idle"){await clearState();state="idle";context={};}

  if(text==="🧾 Bills" && state==="idle"){
    const {data:billServices,error:billError}=await db.from("service_definitions")
      .select("id,code,name,description,category")
      .eq("active",true).neq("category","telecom")
      .order("category",{ascending:true}).order("name",{ascending:true});
    if(billError) throw billError;
    if(!billServices?.length){await send(chatId,"🧾 Bills\n\nNo bill services are available right now.",true);return out({success:true,linked:true,state:"idle"});}
    const services=billServices.map((s:any)=>({id:s.id,code:s.code,name:s.name,category:s.category}));
    await saveState("awaiting_bill_service_selection",{services});
    const keyboard={keyboard:services.map((s:any)=>[{text:s.name}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false};
    await send(chatId,"🧾 Bills\n\nSelect the service you want to pay for:",false,keyboard);
    return out({success:true,linked:true,state:"awaiting_bill_service_selection"});
  }

  if(state==="awaiting_bill_service_selection"){
    if(cancelRequest){await clearState();await send(chatId,"Bill payment cancelled. What would you like to do next?",true);return out({success:true,linked:true,state:"idle"});}
    const services=Array.isArray(context?.services)?context.services:[];
    const selected=services.find((s:any)=>String(s.name).toLowerCase()===text.toLowerCase()||String(s.code).toLowerCase()===text.toLowerCase());
    if(!selected){
      const keyboard={keyboard:services.map((s:any)=>[{text:s.name}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false};
      await send(chatId,"Please select one of the available bill services.",false,keyboard);
      return out({success:true,linked:true,state:"awaiting_bill_service_selection"});
    }
    const {data:purchaseEndpoint,error:purchaseEndpointError}=await db.from("api_endpoints")
      .select("id")
      .eq("service_type",selected.code)
      .eq("operation","purchase")
      .eq("active",true)
      .limit(1)
      .maybeSingle();
    if(purchaseEndpointError) throw purchaseEndpointError;

    if(!purchaseEndpoint){
      await clearState();
      const unavailableMessage =
        "⚠️ "+String(selected.name)+" is currently not available for now.\\n\\nPlease choose another service or try again later.";
      await send(chatId,unavailableMessage,true);
      return out({success:true,linked:true,state:"idle",available:false,service:selected.code});
    }

    const {data:fields,error:fieldError}=await db.from("service_fields")
      .select("field_key,label,data_type,required,validation,display_order")
      .eq("service_id",selected.id).eq("active",true)
      .order("display_order",{ascending:true});
    if(fieldError) throw fieldError;
    const activeFields=(fields||[]).filter((f:any)=>f.required!==false);
    if(!activeFields.length){
      const ai=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},body:JSON.stringify({user_id:acct.user_id,channel:"telegram",message:"I want to pay for "+selected.name})});
      const d=await ai.json().catch(()=>({})); await clearState();
      if(!ai.ok||d?.success===false){await send(chatId,"❌ "+String(d?.error||"I could not start this bill payment."),true);return out({success:false,linked:true,state:"idle"});}
      await send(chatId,String(d?.answer||"Please provide the details required for "+selected.name+"."),true);
      return out({success:true,linked:true,state:"idle",service:selected.code});
    }
    const first=activeFields[0];
    await saveState("awaiting_bill_field",{service_id:selected.id,service_code:selected.code,service_name:selected.name,fields:activeFields,field_index:0,values:{}});
    const validation=first.validation&&typeof first.validation==="object"?first.validation:{};
    const values=Array.isArray(validation.values)?validation.values:[];
    const keyboard=values.length?{keyboard:values.map((v:any)=>[{text:String(v)}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false}:{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false};
    await send(chatId,"🧾 "+selected.name+"\n\n"+String(first.label||first.field_key)+"\n\nPlease enter "+String(first.label||first.field_key).toLowerCase()+".",false,keyboard);
    return out({success:true,linked:true,state:"awaiting_bill_field",service:selected.code});
  }

  if(state==="awaiting_bill_field"){
    if(cancelRequest){await clearState();await send(chatId,"Bill payment cancelled. What would you like to do next?",true);return out({success:true,linked:true,state:"idle"});}
    const fields=Array.isArray(context?.fields)?context.fields:[];
    const index=Number(context?.field_index||0);
    const field=fields[index];
    if(!field){await clearState();await send(chatId,"The bill session expired. Please start again from Bills.",true);return out({success:true,linked:true,state:"idle"});}
    const value=String(text||"").trim();
    const validation=field.validation&&typeof field.validation==="object"?field.validation:{};
    if(field.data_type==="number"){
      const n=Number(value.replace(/,/g,""));
      if(!Number.isFinite(n)||(validation.min!=null&&n<Number(validation.min))){
        await send(chatId,"Please enter a valid "+String(field.label||field.field_key).toLowerCase()+".",false,{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false});
        return out({success:true,linked:true,state:"awaiting_bill_field"});
      }
    }
    if(field.data_type==="enum"&&Array.isArray(validation.values)&&validation.values.length&&!validation.values.map((v:any)=>String(v).toLowerCase()).includes(value.toLowerCase())){
      await send(chatId,"Please select one of the available options.",false,{keyboard:validation.values.map((v:any)=>[{text:String(v)}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_bill_field"});
    }
    const values={...(context.values||{}),[field.field_key]:value};
    const nextIndex=index+1;
    if(nextIndex<fields.length){
      const next=fields[nextIndex];
      const nextValidation=next.validation&&typeof next.validation==="object"?next.validation:{};
      const options=Array.isArray(nextValidation.values)?nextValidation.values:[];
      const keyboard=options.length?{keyboard:options.map((v:any)=>[{text:String(v)}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false}:{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false};
      await saveState("awaiting_bill_field",{...context,values,field_index:nextIndex});
      await send(chatId,"🧾 "+String(context.service_name)+"\n\n"+String(next.label||next.field_key)+"\n\nPlease enter "+String(next.label||next.field_key).toLowerCase()+".",false,keyboard);
      return out({success:true,linked:true,state:"awaiting_bill_field"});
    }
    const detailLines=Object.entries(values).map(([k,v])=>k+": "+String(v)).join(", ");
    const aiMessage="I want to pay for "+String(context.service_name)+" ("+String(context.service_code)+"). Details: "+detailLines;
    const ai=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},body:JSON.stringify({user_id:acct.user_id,channel:"telegram",message:aiMessage})});
    const d=await ai.json().catch(()=>({}));
    await clearState();
    if(!ai.ok||d?.success===false){await send(chatId,"❌ "+String(d?.error||"I could not continue this bill payment."),true);return out({success:false,linked:true,state:"idle"});}
    await send(chatId,String(d?.answer||"Your details have been received. Please follow the next instructions to complete the payment."),true);
    return out({success:true,linked:true,state:"idle",service:context.service_code,details:values});
  }

  const completeAirtimeNaturalRequest=/^(?:buy|purchase|send|get|give me|i want|want|need)\b.*\b(?:mtn|airtel|glo|9mobile|t2)\b.*\bairtime\b.*(?:₦\s*[0-9]|ngn\s*[0-9]|\b[0-9][0-9,]*\b).*\b(?:0\d{10}|234\d{10})\b/i.test(String(text||"").trim()) || /^(?:buy|purchase|send|get|give me|i want|want|need)\b.*\bairtime\b.*\b(?:mtn|airtel|glo|9mobile|t2)\b.*(?:₦\s*[0-9]|ngn\s*[0-9]|\b[0-9][0-9,]*\b).*\b(?:0\d{10}|234\d{10})\b/i.test(String(text||"").trim());
  // A complete natural-language Airtime request must bypass the legacy selector, even if the user is currently inside an Airtime menu state.
  if (completeAirtimeNaturalRequest && state!=="idle") { await clearState(); state="idle"; context={}; }
  const airtimePurchaseIntent=/^(?:buy|purchase|get|i want|want|need|give me|send me|saya|siya)\b.*\bairtime\b|^\s*airtime\s*$/i.test(String(text||"").trim()) || /\bairtime\b.*\b(?:buy|purchase|send|saya|siya)\b/i.test(String(text||"").trim());
  if(airtimePurchaseIntent && state==="idle" && !completeAirtimeNaturalRequest){
    const {data:airtimeNetworks,error:airtimeIntentError}=await db.from("service_networks")
      .select("id,code,name,service_definitions!inner(code,name,active)")
      .eq("active",true).eq("service_definitions.code","airtime")
      .eq("service_definitions.active",true).order("name",{ascending:true});
    if(airtimeIntentError) throw airtimeIntentError;
    if(!airtimeNetworks?.length){
      await send(chatId,"📱 Airtime\\n\\nNo Airtime networks are available right now.",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const networks=airtimeNetworks.map((n:any)=>({id:n.id,code:n.code,name:canonicalNetworkLabel(n.code,n.name)}));
    await saveState("awaiting_airtime_network_selection",{networks});
    const keyboard={keyboard:networks.map((n:any)=>[{text:n.name}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false};
    await send(chatId,"📱 Airtime\\n\\nWhich network do you want?\\n\\nSelect MTN, Airtel, Glo or 9mobile (T2).",false,keyboard);
    return out({success:true,linked:true,state:"awaiting_airtime_network_selection"});
  }

  if(text==="📱 Airtime" && state==="idle"){
    const {data:airtimeNetworks,error:airtimeError}=await db.from("service_networks")
      .select("id,code,name,service_definitions!inner(code,name,active)")
      .eq("active",true).eq("service_definitions.code","airtime")
      .eq("service_definitions.active",true).order("name",{ascending:true});
    if(airtimeError) throw airtimeError;
    if(!airtimeNetworks?.length){
      await send(chatId,"📱 Airtime\n\nNo Airtime networks are available right now.",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const networks=airtimeNetworks.map((n:any)=>({id:n.id,code:n.code,name:canonicalNetworkLabel(n.code,n.name)}));
    await saveState("awaiting_airtime_network_selection",{networks});
    const keyboard={keyboard:networks.map((n:any)=>[{text:n.name}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false};
    await send(chatId,"📱 Airtime\n\nSelect the network you want to buy airtime for:",false,keyboard);
    return out({success:true,linked:true,state:"awaiting_airtime_network_selection"});
  }

  if(state==="awaiting_airtime_network_selection" && !completeAirtimeNaturalRequest){
    if(cancelRequest){await clearState();await send(chatId,"Airtime purchase cancelled. What would you like to do next?",true);return out({success:true,linked:true,state:"idle"});}
    const networks=Array.isArray(context?.networks)?context.networks:[];
    const selected=networks.find((n:any)=>String(n.name).toLowerCase()===text.toLowerCase()||String(n.code).toLowerCase()===text.toLowerCase());
    if(!selected){
      const keyboard={keyboard:networks.map((n:any)=>[{text:n.name}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false};
      await send(chatId,"Please select one of the available Airtime networks.",false,keyboard);
      return out({success:true,linked:true,state:"awaiting_airtime_network_selection"});
    }
    await saveState("awaiting_airtime_amount",{network_code:selected.code,network_name:canonicalNetworkLabel(selected.code,selected.name)});
    await send(chatId,"📱 "+selected.name+" Airtime\n\nHow much airtime do you want to buy?\n\nExample: 1000",false,{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_airtime_amount"});
  }

  if(state==="awaiting_airtime_amount"){
    if(cancelRequest){await clearState();await send(chatId,"Airtime purchase cancelled. What would you like to do next?",true);return out({success:true,linked:true,state:"idle"});}
    if(!amountMatch){
      await send(chatId,"Please enter a valid airtime amount, for example: 1000.",false,{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_airtime_amount"});
    }
    const amount=Number(String(amountMatch[1]).replace(/,/g,""));
    if(!Number.isFinite(amount)||amount<=0){
      await send(chatId,"Please enter a valid airtime amount, for example: 1000.",false,{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_airtime_amount"});
    }
    await saveState("awaiting_airtime_recipient",{network_code:context.network_code,network_name:context.network_name,amount});
    await send(chatId,"Amount: ₦"+amount.toLocaleString("en-NG")+"\nNetwork: "+String(context.network_name||context.network_code)+"\n\nSend the recipient phone number (e.g. 08012345678).",false,{keyboard:[[ {text:"↩️ Main Menu" }]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_airtime_recipient"});
  }

  if(state==="awaiting_airtime_recipient"){
    if(cancelRequest){await clearState();await send(chatId,"Airtime purchase cancelled. What would you like to do next?",true);return out({success:true,linked:true,state:"idle"});}
    const digits=String(text||"").replace(/[^0-9]/g,"");
    const normalizedPhone=digits.startsWith("234")&&digits.length===13?"0"+digits.slice(3):digits;
    if(!/^0[789][0-9]{9}$/.test(normalizedPhone)){
      await send(chatId,"Please enter a valid Nigerian phone number, for example: 08012345678.",false,{keyboard:[[ {text:"↩️ Main Menu" }]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_airtime_recipient"});
    }
    await saveState("awaiting_airtime_confirmation",{network_code:context.network_code,network_name:context.network_name,amount:context.amount,phone_number:normalizedPhone});
    await send(chatId,
      "📱 Confirm Airtime Purchase\n\nNetwork: "+String(context.network_name||context.network_code)+
      "\nAmount: ₦"+Number(context.amount||0).toLocaleString("en-NG")+
      "\nRecipient: "+normalizedPhone+
      "\n\nDo you want to proceed?",
      false,{keyboard:[[{text:"✅ Confirm Purchase"},{text:"❌ Cancel"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_airtime_confirmation"});
  }

  if(state==="awaiting_airtime_confirmation"){
    if(cancelRequest||/^❌\s*cancel$/i.test(text)){
      await clearState();await send(chatId,"Airtime purchase cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }
    if(!/^✅\s*confirm purchase$/i.test(text)&&!/^(yes|confirm|confirmed|proceed|go ahead|eh|e|naam)$/i.test(text)){
      await send(chatId,"Please tap ✅ Confirm Purchase to proceed, or ❌ Cancel.",false,{keyboard:[[{text:"✅ Confirm Purchase"},{text:"❌ Cancel"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_airtime_confirmation"});
    }
    const purchaseReference="TG-AIR-"+Date.now()+"-"+Math.random().toString(36).slice(2,8).toUpperCase();
    const payload={
      user_id:acct.user_id,
      channel:"telegram",
      action:"airtime_purchase",
      network:String(context.network_code||"").toLowerCase(),
      amount:Number(context.amount||0),
      phone_number:String(context.phone_number||""),
      reference:purchaseReference,
      idempotency_key:"TG-AIR-"+acct.user_id+"-"+String(context.network_code||"")+"-"+String(context.amount||0)+"-"+String(context.phone_number||"")
    };
    const ai=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},body:JSON.stringify(payload)});
    const d=await ai.json().catch(()=>({}));
    if(!ai.ok||d?.success===false){
      await send(chatId,"❌ "+String(d?.error||"The Airtime purchase could not be completed."),true);
      return out({success:false,linked:true,state:"awaiting_airtime_confirmation"});
    }
    await clearState();
    await send(chatId,String(d?.answer||"Airtime purchase request submitted."),true);
    return out({success:true,linked:true,state:"idle"});
  }

  if(text==="📦 Buy Data" && state==="idle"){
    await saveState("awaiting_network_selection",{});
    await send(chatId,"📦 Buy Data\n\nWhich network do you want?\n\nSelect MTN, Airtel, Glo or T2.",false,networkKeyboard);
    return out({success:true,linked:true,state:"awaiting_network_selection"});
  }

  if(state==="awaiting_recommendation_selection"){
    if(cancelRequest){
      await clearState();
      await send(chatId,"Recommendation cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const match=String(text||"").trim().match(/^(?:option\\s*)?(\\d+)$/i);
    const index=match?Number(match[1])-1:-1;
    const recs=Array.isArray(context?.recommendations)?context.recommendations:[];
    const selected=index>=0?recs[index]:null;
    if(!selected){
      await send(chatId,"Please choose 1, 2 or 3, or tap ↩️ Main Menu.",false,{keyboard:[[{text:"1"},{text:"2"},{text:"3"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_recommendation_selection"});
    }
    await saveState("awaiting_data_recipient",{
      product_id:selected.product_id||selected.id,
      product_name:selected.product_name,
      network_code:selected.network_code||selected.network||"",
      network_name:selected.network_name||selected.network||"",
      volume:selected.volume||"",
      price:Number(selected.selling_price||0),
      variant_name:selected.variant_name||selected.variant||"",
      validity_type:selected.validity_type||"",
      validity_value:selected.validity_value??null,
      validity_unit:selected.validity_unit||""
    });
    await send(chatId,"Selected: "+String(selected.product_name||selected.volume||"Data plan")+" — ₦"+Number(selected.selling_price||0).toLocaleString("en-NG")+"\n\nWho should receive it? Send the recipient phone number (e.g. 08012345678).",false,{keyboard:[[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_data_recipient",product:selected});
  }

  if(state==="awaiting_plan_selection"){
    if(cancelRequest){
      await clearState();
      await send(chatId,"Data purchase cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const storedPlans=Array.isArray(context?.plans)?context.plans:[];
    const match=String(text||"").trim().match(/^(\d+)\./);
    const selectedIndex=match?Number(match[1])-1:-1;
    const selectedPlan=selectedIndex>=0?storedPlans[selectedIndex]:null;
    if(!selectedPlan){
      await send(chatId,"Please select one of the available plans, or tap ↩️ Main Menu.",false,{keyboard:storedPlans.map((p:any,i:number)=>[{text:String(i+1)+". "+(p.volume||p.product_name||"Data plan")+" — ₦"+Number(p.selling_price||0).toLocaleString("en-NG")}]).concat([[{text:"↩️ Main Menu"}]]),resize_keyboard:true,is_persistent:false});
      return out({success:true,linked:true,state:"awaiting_plan_selection"});
    }
    await saveState("awaiting_data_recipient",{product_id:selectedPlan.id,product_name:selectedPlan.product_name,network_code:context.network_code,network_name:context.network_name,volume:selectedPlan.volume,price:Number(selectedPlan.selling_price||0),variant_name:selectedPlan.variant_name||"",validity_type:selectedPlan.validity_type||"",validity_value:selectedPlan.validity_value??null,validity_unit:selectedPlan.validity_unit||""});
    await send(chatId,"Selected: "+String(selectedPlan.product_name||selectedPlan.volume||"Data plan")+" — ₦"+Number(selectedPlan.selling_price||0).toLocaleString("en-NG")+"\n\nWho should receive it? Send the recipient phone number (e.g. 08012345678).",false,{keyboard:[[ {text:"↩️ Main Menu"} ]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_data_recipient",product:selectedPlan});
  }

  if(state==="awaiting_data_recipient"){
    if(cancelRequest){await clearState();await send(chatId,"Data purchase cancelled. What would you like to do next?",true);return out({success:true,linked:true,state:"idle"});}
    const digits=String(text||"").replace(/[^0-9]/g,""); const normalizedPhone=digits.startsWith("234")&&digits.length===13?"0"+digits.slice(3):digits;
    if(!/^0[789][0-9]{9}$/.test(normalizedPhone)){await send(chatId,"Please enter a valid Nigerian mobile number.\n\nExample: 08012345678",false,{keyboard:[[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});return out({success:true,linked:true,state:"awaiting_data_recipient"});}
    const {data:walletBeforeData,error:walletBeforeError}=await db.rpc("get_my_balance",{p_user_id:acct.user_id});
    if(walletBeforeError) throw walletBeforeError;
    const walletBefore=Number(walletBeforeData?.[0]?.balance??0);
    const price=Number(context.price||0);
    await saveState("awaiting_data_confirmation",{...context,phone_number:normalizedPhone,wallet_before:walletBefore,price});
    await send(chatId,"📦 Confirm Data Purchase\n\nNetwork: "+String(context.network_name||context.network_code||"—")+"\nPlan: "+String(context.product_name||context.volume||"Data plan")+"\nRecipient: "+normalizedPhone+"\nPrice: ₦"+price.toLocaleString("en-NG")+"\nWallet balance: ₦"+walletBefore.toLocaleString("en-NG")+"\nAfter purchase: ₦"+Math.max(0,walletBefore-price).toLocaleString("en-NG")+"\n\nTap “✅ Confirm Purchase” to complete it.",false,{keyboard:[[{text:"✅ Confirm Purchase"},{text:"❌ Cancel"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false});
    return out({success:true,linked:true,state:"awaiting_data_confirmation"});
  }

  if(state==="awaiting_data_confirmation"){
    if(cancelRequest||/^❌\s*cancel$/i.test(text)){
      await clearState();
      await send(chatId,"Data purchase cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }
    const confirmed=/^✅\s*confirm purchase$/i.test(text)||/^(yes|confirm|confirmed|proceed|go ahead|eh|e|naam)$/i.test(text);
    if(!confirmed){
      await send(chatId,"Please tap “✅ Confirm Purchase” to continue, or “❌ Cancel” to stop.",false,{
        keyboard:[
          [{text:"✅ Confirm Purchase"},{text:"❌ Cancel"}],
          [{text:"↩️ Main Menu"}]
        ],
        resize_keyboard:true,
        is_persistent:false
      });
      return out({success:true,linked:true,state:"awaiting_data_confirmation"});
    }
    const {data:confirmationClaim,error:confirmationClaimError}=await db
      .from("telegram_conversation_states")
      .update({
        state:"processing_data_purchase",
        updated_at:new Date().toISOString()
      })
      .eq("telegram_chat_id",chatId)
      .eq("user_id",acct.user_id)
      .eq("state","awaiting_data_confirmation")
      .select("state")
      .maybeSingle();
    if(confirmationClaimError) throw confirmationClaimError;
    if(!confirmationClaim){
      await send(chatId,"⏳ This purchase confirmation is already being processed. Please wait for the result.",true);
      return out({success:true,linked:true,state:"processing_data_purchase",duplicate_confirmation:true});
    }
    state="processing_data_purchase";
    const walletBefore=Number(context.wallet_before||0);
    const price=Number(context.price||0);
    const purchaseReference="TG-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
    const ai=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},body:JSON.stringify({user_id:acct.user_id,channel:"telegram",action:"purchase",product_id:String(context.product_id||""),phone_number:String(context.phone_number||""),customer_input:{phone:String(context.phone_number||"")},reference:purchaseReference,idempotency_key:"TG-"+acct.user_id+"-"+String(context.product_id||"")+"-"+String(context.phone_number||"")+"-"+String(context.wallet_before||"")+"-"+String(context.price||"")})});
    const d=await ai.json().catch(()=>({}));
    const {data:walletAfterData,error:walletAfterError}=await db.rpc("get_my_balance",{p_user_id:acct.user_id});
    if(walletAfterError) throw walletAfterError;
    const walletAfter=Number(walletAfterData?.[0]?.balance??walletBefore);
    await clearState();
    if(!ai.ok||d?.success===false){await send(chatId,"❌ "+String(d?.error||"I could not complete this purchase right now.")+"\n\nPrice: ₦"+price.toLocaleString("en-NG")+"\nWallet: ₦"+walletAfter.toLocaleString("en-NG"),true);return out({success:false,linked:true,state:"idle"});}
    const purchase=d?.purchase||{};
    const status=String(purchase?.status||"pending").toLowerCase();
    const label=String(context.product_name||context.volume||"Data plan");
    const variant=String(context.variant_name||"").trim();
    const validity=context.validity_type==="unlimited"?"Unlimited":(context.validity_value&&context.validity_unit?String(context.validity_value)+" "+String(context.validity_unit):"");
    const planBought=[label,variant,validity].filter(Boolean).join(" • ");
    const network=String(context.network_name||context.network_code||"—");
    const recipient=String(context.phone_number||"");
    const walletLine="Wallet: ₦"+walletBefore.toLocaleString("en-NG")+" → ₦"+walletAfter.toLocaleString("en-NG");
    const resultMessage=status==="successful"?"✅ Data purchase successful!\n\nPlan bought: "+planBought+"\nNetwork: "+network+"\nData sent to: "+recipient+"\nPrice: ₦"+price.toLocaleString("en-NG")+"\n"+walletLine+(purchase?.reference?"\nReference: "+String(purchase.reference):""):status==="failed"?"❌ Data purchase failed.\n\nPlan: "+planBought+"\nNetwork: "+network+"\nRecipient: "+recipient+"\nPrice: ₦"+price.toLocaleString("en-NG")+"\n"+walletLine+"\n\nAny applicable wallet refund is handled by the transaction system.":"⏳ Data purchase is still processing.\n\nPlan: "+planBought+"\nNetwork: "+network+"\nRecipient: "+recipient+"\nPrice: ₦"+price.toLocaleString("en-NG")+"\n"+walletLine+"\n\nYou do not need to confirm again.";
    if(status==="successful"){
      // Detailed receipt with a 🔄 Buy Again inline button. The persistent main menu is restored in a follow-up message,
      // and the previous plain success message is kept as a fallback so a receipt is never lost.
      const receiptDigits=recipient.replace(/\D/g,"");
      const maskedRecipient=receiptDigits.length>=7?receiptDigits.slice(0,4)+"****"+receiptDigits.slice(-3):"—";
      const receiptTime=new Date().toLocaleString("en-NG",{timeZone:"Africa/Lagos",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true});
      const receiptReference=String(purchase?.reference||purchaseReference);
      const receiptText=[
        "🧾 Transaction Receipt",
        "",
        "✅ Status: Successful",
        "",
        "Plan: "+planBought,
        "Network: "+network,
        "Recipient: "+maskedRecipient,
        "Amount paid: ₦"+price.toLocaleString("en-NG"),
        "Wallet balance: ₦"+walletAfter.toLocaleString("en-NG"),
        "Reference: "+receiptReference,
        "Date: "+receiptTime
      ].join("\n");
      let receiptSent=false;
      try{
        await send(chatId,receiptText,false,{inline_keyboard:[[{text:"🔄 Buy Again",callback_data:"receipt_buy_again"}]]});
        receiptSent=true;
      }catch(receiptError){
        console.error("Telegram receipt:",receiptError);
      }
      if(receiptSent){
        try{await send(chatId,"What would you like to do next?",true);}catch(menuError){console.error("Telegram receipt menu:",menuError);}
      }else{
        await send(chatId,resultMessage,true);
    if(status==="successful"){ await send(chatId,"🧾 Receipt\n\n📦 "+planBought+"\n📡 "+network+"\n📱 "+(recipient.length>=10?recipient.slice(0,4)+"••••"+recipient.slice(-3):recipient)+"\n💰 ₦"+price.toLocaleString("en-NG")+"\n📊 Successful\n"+walletLine+(purchase?.reference?"\n🧾 Ref: "+String(purchase.reference):"")+"\n🕐 "+new Date().toLocaleString("en-NG",{timeZone:"Africa/Lagos"}),false,{keyboard:[[{text:"🔄 Buy Again"}],[{text:"↩️ Main Menu"}]],resize_keyboard:true,is_persistent:false}); }
      }
    }else{
      await send(chatId,resultMessage,true);
    }
    return out({success:true,linked:true,state:"idle",purchase:true,status,wallet_before:walletBefore,wallet_after:walletAfter,price});
  }

  if(state==="awaiting_network_selection"){
    if(cancelRequest){
      await clearState();
      await send(chatId,"Data purchase cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }
    if(!selectedNetworkCode){
      await send(chatId,"Please select a network: MTN, Airtel, Glo or T2.",false,networkKeyboard);
      return out({success:true,linked:true,state:"awaiting_network_selection"});
    }

    const {data:networkRows,error:networkError}=await db
      .from("service_networks")
      .select("id,code,name,service_definitions!inner(code)")
      .eq("code",selectedNetworkCode)
      .eq("active",true)
      .eq("service_definitions.code","data")
      .order("name",{ascending:true});
    if(networkError) throw networkError;

    const networks=networkRows||[];
    if(!networks.length){
      await send(chatId,"That network is not available right now. Please choose another network.",false,networkKeyboard);
      return out({success:true,linked:true,state:"awaiting_network_selection"});
    }
    let network=networks[0]||null;
    if(network) network={...network,name:canonicalNetworkLabel(network.code,network.name)};

    const networkIds=networks.map((n:any)=>n.id);
    const {data:plans,error:plansError}=await db
      .from("products")
      .select("id,network_id,product_name,service_type,volume,selling_price,validity_type,validity_value,validity_unit,service_networks(code,name),service_variants(code,name)")
      .eq("active",true)
      .in("network_id",networkIds.length?networkIds:["00000000-0000-0000-0000-000000000000"])
      .order("display_order",{ascending:true})
      .order("selling_price",{ascending:true});
    if(plansError) throw plansError;

    if(plans?.length){
      const matchingNetworkId=plans[0].network_id||null;
      network=networks.find((n:any)=>n.id===matchingNetworkId)||network;
      if(network) network={...network,name:canonicalNetworkLabel(network.code,network.name)};
    }
    if(!plans?.length){
      await send(chatId,"📦 "+String(network.name)+" Data\n\nThere are no active plans for "+String(network.name)+" right now.\n\nPlease choose another network.",false,networkKeyboard);
      return out({success:true,linked:true,state:"awaiting_network_selection",network:network.code,plans:[]});
    }

    const lines=plans.map((p:any,i:number)=>{
      const duration=p.validity_type==="fixed"&&p.validity_value&&p.validity_unit?String(p.validity_value)+" "+String(p.validity_unit):p.validity_type==="unlimited"?"Unlimited":"";
      const details=[p.volume,duration].filter(Boolean).join(" • ");
      return (i+1)+". "+(p.product_name||"Data plan")+" — ₦"+Number(p.selling_price||0).toLocaleString("en-NG")+(details?"\n   "+details:"");
    });
    const planKeyboard={
      keyboard:plans.map((p:any,i:number)=>[{text:String(i+1)+". "+(p.volume||p.product_name||"Data plan")+" — ₦"+Number(p.selling_price||0).toLocaleString("en-NG")}]).concat([[{text:"↩️ Main Menu"}]]),
      resize_keyboard:true,
      is_persistent:false
    };

    await saveState("awaiting_plan_selection",{
      network_code:network.code,
      network_name:canonicalNetworkLabel(network.code,network.name),
      plans:(plans||[]).map((p:any)=>({id:p.id,product_name:p.product_name,volume:p.volume,selling_price:p.selling_price,validity_type:p.validity_type,validity_value:p.validity_value,validity_unit:p.validity_unit,variant_name:(Array.isArray(p.service_variants)?p.service_variants[0]?.name:p.service_variants?.name)||"",network_name:(Array.isArray(p.service_networks)?p.service_networks[0]?.name:p.service_networks?.name)||""}))
    });

    await send(chatId,"📦 "+String(canonicalNetworkLabel(network.code,network.name))+" Data Plans\n\n"+lines.join("\n\n")+"\n\nSelect a plan below:",false,planKeyboard);
    return out({success:true,linked:true,state:"awaiting_plan_selection",network:network.code,network_name:network.name,plans});
  }

  // Quick-access wallet must be deterministic: read the live wallet directly
  // instead of relying on the AI intent classifier.
  if(text==="👤 My Account"){
    const {data:user,error:userError}=await db.from("users").select("name,email,phone,language,role,created_at").eq("id",acct.user_id).maybeSingle();
    if(userError) throw userError;
    const {data:walletData,error:walletError}=await db.rpc("get_my_balance",{p_user_id:acct.user_id});
    if(walletError) throw walletError;
    const balance=Number(walletData?.[0]?.balance??0);
    const {count:txCount,error:countError}=await db.from("transactions").select("id",{count:"exact",head:true}).eq("user_id",acct.user_id);
    if(countError) throw countError;
    const name=String(user?.name||"Customer");
    const phone=String(user?.phone||"—");
    const email=String(user?.email||"—");
    const language=String(user?.language||"english");
    const joined=user?.created_at?new Date(user.created_at).toLocaleDateString("en-NG",{day:"2-digit",month:"short",year:"numeric"}):"—";
    const message=[
      "👤 My Account",
      "",
      "Name: "+name,
      "Phone: "+phone,
      "Email: "+email,
      "Language: "+language,
      "Wallet Balance: ₦"+balance.toLocaleString("en-NG"),
      "Transactions: "+Number(txCount||0),
      "Joined: "+joined
    ].join("\n");
    const warning=walletWarning(balance);
    await send(chatId,message+(warning?"\n\n"+warning:""),true);
    return out({success:true,linked:true,account:user,wallet_balance:balance,transaction_count:Number(txCount||0),wallet_warning:warning||null});
  }
  if(text==="🧾 Transactions"){
    const {data:rows,error:txError}=await db
      .from("transactions")
      .select("id,created_at,phone_number,amount,status,description,service_type,products(product_name,volume,service_networks(code,name))")
      .eq("user_id",acct.user_id)
      .order("created_at",{ascending:false})
      .limit(5);
    if(txError) throw txError;
    const list=rows||[];
    if(!list.length){
      await send(chatId,"🧾 Transactions\\n\\nYou do not have any purchases yet.",true);
      return out({success:true,linked:true,transactions:[]});
    }
    const lines=list.map((tx:any,i:number)=>{
      const p=Array.isArray(tx.products)?tx.products[0]:tx.products;
      const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks;
      const phone=String(tx.phone_number||"").replace(/\\D/g,"");
      const masked=phone.length>=7?phone.slice(0,4)+"****"+phone.slice(-3):"—";
      const date=tx.created_at?new Date(tx.created_at).toLocaleString("en-NG",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
      return (i+1)+". "+(p?.product_name||tx.description||"Purchase")+" — ₦"+Number(tx.amount||0).toLocaleString("en-NG")+"\\n   "+(n?.code||n?.name||tx.service_type||"Service")+" • "+masked+" • "+String(tx.status||"pending")+"\\n   "+date;
    });
    await send(chatId,"🧾 Recent Transactions\\n\\n"+lines.join("\\n\\n"),true);
    return out({success:true,linked:true,transactions:list});
  }
  if(text==="💳 Wallet History"){
    const {data:rows,error:historyError}=await db
      .from("wallet_transactions")
      .select("id,type,amount,reference,balance_before,balance_after,status,created_at")
      .eq("user_id",acct.user_id)
      .order("created_at",{ascending:false})
      .limit(10);
    if(historyError) throw historyError;
    const list=rows||[];
    if(!list.length){
      await send(chatId,"💳 Wallet History\\n\\nYou do not have any wallet activity yet.",true);
      return out({success:true,linked:true,wallet_history:[]});
    }
    const icon=(type:string)=>type==="funding"?"➕":type==="refund"?"↩️":type==="purchase"?"🛒":"⚙️";
    const label=(type:string)=>type==="funding"?"Wallet Funding":type==="refund"?"Refund":type==="purchase"?"Purchase":"Wallet Adjustment";
    const lines=list.map((tx:any,i:number)=>{
      const sign=tx.type==="purchase"?"-":"+";
      const ref=String(tx.reference||"");
      const maskedRef=ref.length>14?ref.slice(0,10)+"..."+ref.slice(-4):ref||"—";
      const date=tx.created_at?new Date(tx.created_at).toLocaleString("en-NG",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
      const balanceAfter=tx.balance_after===null||tx.balance_after===undefined?"—":"₦"+Number(tx.balance_after).toLocaleString("en-NG");
      return (i+1)+". "+icon(String(tx.type))+" "+label(String(tx.type))+"\\n   "+sign+"₦"+Number(tx.amount||0).toLocaleString("en-NG")+" • "+String(tx.status||"pending")+"\\n   Balance: "+balanceAfter+" • "+date+"\\n   Ref: "+maskedRef;
    });
    await send(chatId,"💳 Wallet History\\n\\n"+lines.join("\\n\\n"),true);
    return out({success:true,linked:true,wallet_history:list});
  }
  if(text==="💰 Wallet"){
    const {data:walletData,error:walletError}=await db.rpc("get_my_balance",{p_user_id:acct.user_id});
    if(walletError) throw walletError;
    const wallet=walletData?.[0];
    const balance=Number(wallet?.balance??0);
    const currency=String(wallet?.currency||"NGN").toUpperCase();
    const warning=walletWarning(balance);
    await send(chatId,"💰 Wallet Balance\\n\\nBalance: ₦"+balance.toLocaleString("en-NG")+"\\nCurrency: "+currency+(warning?"\\n\\n"+warning:""),true);
    return out({success:true,linked:true,wallet_balance:balance,currency,wallet_warning:warning||null});
  }
  if(mapped) { /* menu buttons are normal Telegram messages; continue using the same central AI/state flow */ }
  if(state==="awaiting_funding_amount"){
    if(cancelRequest){
      await clearState();
      await send(chatId,"Funding cancelled. What would you like to do next?",true);
      return out({success:true,linked:true,state:"idle"});
    }

    const amountText=String(text||"").trim();
    const amountValue=Number(amountText.replace(/^(?:₦|NGN|naira)\\s*/i,"").replace(/,/g,""));
    if(!Number.isFinite(amountValue)||amountValue<=0){
      await send(chatId,"Please enter a valid amount. Example: 5000",true);
      return out({success:true,linked:true,state:"awaiting_funding_amount"});
    }

    const ai=await fetch(url,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":key,
        "Authorization":"Bearer "+key,
        "X-Bindawasub-Channel":"telegram"
      },
      body:JSON.stringify({
        user_id:acct.user_id,
        channel:"telegram",
        action:"manual_funding_request",
        amount:amountValue
      })
    });
    const d=await ai.json().catch(()=>({}));

    if(!ai.ok||d?.success===false){
      await clearState();
      await send(chatId,"❌ "+String(d?.error||"Manual wallet funding is currently unavailable."),true);
      return out({success:false,linked:true,state:"idle"});
    }

    const request=d?.request;
    if(!request?.id){
      await clearState();
      await send(chatId,String(d?.answer||"Manual funding could not be started right now."),true);
      return out({success:false,linked:true,state:"idle"});
    }

    const account=d?.bank_account;
    const instructions=String(d?.instructions||"Transfer the exact amount to the configured Bindawasub bank account, then send your transfer reference.");

    await saveState("awaiting_funding_reference",{
      request_id:String(request.id),
      amount:Number(request.amount||amountValue),
      reference:String(request.reference||"")
    });

    const accountText=account
      ? "\n\n🏦 Bank: "+String(account.bank_name||"—")+"\nAccount Name: "+String(account.account_name||"—")+"\nAccount Number: "+String(account.account_number||"—")
      : "\n\n⚠️ Bank transfer details are not configured yet. Please contact Bindawasub support.";

    await send(
      chatId,
      "💰 Manual Wallet Funding\n\n"+
      "Amount: ₦"+Number(request.amount||amountValue).toLocaleString("en-NG")+
      accountText+
      "\n\n"+instructions+
      "\n\nAfter making the transfer, send your transfer/payment reference here.\n\nCustomer Care: @Aliyubdw",
      true
    );
    return out({success:true,linked:true,state:"awaiting_funding_reference",funding_mode:"manual",request});
  }

  if(state==="awaiting_funding_reference"){
    if(cancelRequest){await clearState();await send(chatId,"Funding request remains pending. No payment reference was submitted.",true);return out({success:true,linked:true,state:"idle"})}
    const requestId=String(context.request_id||"").trim();if(!requestId){await clearState();await send(chatId,"Your funding session expired. Please tap Fund Wallet to start again.",true);return out({success:true,linked:true,state:"idle"})}
    const sessionId=String(text||"").replace(/\s+/g,"").trim();
    if(!/^\d{30}$/.test(sessionId)){await send(chatId,"❌ Invalid Moniepoint Session ID.\n\nPlease send the exact 30-digit Session ID from your Moniepoint transfer receipt.\n\nCustomer Care: @Aliyubdw",true);return out({success:false,linked:true,state:"awaiting_funding_reference",error:"invalid_moniepoint_session_id"})}
    const ai=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},body:JSON.stringify({user_id:acct.user_id,channel:"telegram",action:"manual_funding_submit",request_id:requestId,payment_reference:sessionId})});
    const d=await ai.json().catch(()=>({}));if(!ai.ok||d?.success===false){await send(chatId,"❌ "+String(d?.error||"I could not submit that reference. Please check it and send it again.\n\nCustomer Care: @Aliyubdw"),true);return out({success:false,state:"awaiting_funding_reference"})}
    await clearState();await send(chatId,String(d?.answer||"Payment reference submitted. Your funding request is waiting for admin verification."),true);return out({success:true,linked:true,state:"idle"});
  }
  if(state==="idle" && fundingIntent){
    await saveState("awaiting_funding_amount",{});
    await send(chatId,"💰 Wallet Funding\n\nHow much would you like to add to your wallet?\n\nExample: 5000",true);
    return out({success:true,linked:true,state:"awaiting_funding_amount"});
  }
  // Legacy recommendation fallback removed: bindawasub-ai is the single recommendation engine.

  const normalizedText=effectiveText.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const catalogRequest=/\b(show|list|see|view|give|what|which|available|nawa|ina)\b/.test(normalizedText)&&/\b(data|package|packages|plan|plans|mtn|glo|airtel|9mobile)\b/.test(normalizedText)&&!/\b(buy|purchase|send|siya|saya|for|zuwa)\b/.test(normalizedText);
  const formatProducts=async()=>{const {data:products,error}=await db.from("products").select("id,product_name,service_type,volume,selling_price,validity_type,validity_value,validity_unit,service_networks(code,name),service_variants(code,name)").eq("active",true).order("selling_price",{ascending:true});if(error)throw error;if(!products?.length){await send(chatId,"There are no active data plans available right now.",true);return}const lines=products.map((p:any,i:number)=>{const n=Array.isArray(p.service_networks)?p.service_networks[0]:p.service_networks;const duration=p.validity_type==="fixed"&&p.validity_value&&p.validity_unit?String(p.validity_value)+" "+String(p.validity_unit):p.validity_type==="unlimited"?"Unlimited":"";const details=[n?.name||n?.code,p.volume,duration].filter(Boolean).join(" • ");return (i+1)+". "+(p.product_name||"Data plan")+" — ₦"+Number(p.selling_price||0).toLocaleString("en-NG")+"\n   "+details});await send(chatId,"📦 Available data plans\n\n"+lines.join("\n\n")+"\n\nTo buy one, send: buy 1GB for 080xxxxxxxx",true)};
  if(catalogRequest){await saveState("awaiting_network_selection",{});await send(chatId,"📦 Buy Data\n\nWhich network do you want?\n\nSelect MTN, Airtel, Glo or T2.",false,networkKeyboard);return out({success:true,linked:true,state:"awaiting_network_selection"})}
  // Resolve saved beneficiary names before AI purchase routing.
  // Examples: "buy 1GB MTN for Mum", "send 2GB to wife".
  // The resolved phone is passed to the same existing purchase flow; no separate purchase logic is created here.
  const purchaseLike=/\b(?:buy|purchase|send|get|give|saya|siya)\b/i.test(String(effectiveText||""));
  if(purchaseLike){
    const targetMatch=String(effectiveText||"").match(/\b(?:for|to|zuwa)\s+(.+?)\s*$/i);
    const targetName=normalizeBeneficiaryName(targetMatch?.[1]||"");
    const targetLooksLikePhone=/^(?:\+?234|0)?\d{10,13}$/.test(targetName.replace(/[\s-]/g,""));
    if(targetName && !targetLooksLikePhone){
      const {data:savedTargets,error:savedTargetError}=await db.from("saved_beneficiaries").select("name,phone_number").eq("user_id",acct.user_id);
      if(savedTargetError) throw savedTargetError;
      const target=savedTargets?.find((b:any)=>String(b.name||"").trim().toLowerCase()===targetName.toLowerCase());
      if(target?.phone_number && targetMatch){
        effectiveText=String(effectiveText).slice(0,targetMatch.index||0)+targetMatch[0].replace(targetMatch[1],String(target.phone_number));
      }
    }
  }

  const runAi=async()=>{try{
    const spendingRequest=/(?:\bhow much (?:have|did) i (?:spend|spent)\b|\bwhat did i spend\b|\bspending (?:summary|analysis|report)\b|\bwhat network .*?(?:buy|purchase).*(?:most|the most)\b|\bnawa .*?(?:kashe|na kashe)\b|\bwace network .*?(?:saya|akai-akai)\b)/i.test(String(effectiveText||""));
    if(spendingRequest){
      const spendingUrl=Deno.env.get("SUPABASE_URL")!+"/functions/v1/spending-analysis";
      const spendingRes=await fetch(spendingUrl,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key},body:JSON.stringify({user_id:acct.user_id,message:effectiveText})});
      const spending=await spendingRes.json().catch(()=>({}));
      if(!spendingRes.ok||spending?.success===false){await send(chatId,"❌ I couldn't retrieve your spending summary right now. Please try again.",true);return}
      await send(chatId,String(spending.answer||("You have spent ₦"+Number(spending.total_spent||0).toLocaleString("en-NG")+" across "+Number(spending.purchase_count||0)+" successful purchases.")),true);
      return;
    }
    let aiPayload:any={user_id:acct.user_id,channel:"telegram",message:effectiveText};
    if (pendingConversationId) aiPayload.conversation_id = pendingConversationId;const amountOnly=String(effectiveText||"").trim().match(/^(?:₦\s*|NGN\s*|naira\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/i);if(amountOnly){const {data:latestConversation}=await db.from("ai_conversations").select("id").eq("user_id",acct.user_id).eq("channel","telegram").order("last_message_at",{ascending:false}).limit(1).maybeSingle();if(latestConversation?.id){const {data:recentUsers}=await db.from("ai_messages").select("message,created_at").eq("conversation_id",latestConversation.id).eq("role","user").order("created_at",{ascending:false}).limit(2);const previous=String(recentUsers?.[1]?.message||"").trim().toLowerCase();if(/\b(fund|funding|deposit|top ?up|add money|add funds)\b/.test(previous)&&/\b(wallet|money|fund|funding|deposit|top ?up)\b/.test(previous)){const amount=Number(String(amountOnly[1]).replace(/,/g,""));if(Number.isFinite(amount)&&amount>0){aiPayload.action="manual_funding_request";aiPayload.amount=amount}}}}const ai=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key,"X-Bindawasub-Channel":"telegram"},body:JSON.stringify(aiPayload)});const d=await ai.json().catch(()=>({}));if(!ai.ok){console.error("Telegram AI bridge:",{status:ai.status,error:d?.error||null});const msg=String(d?.error||"Bindawasub AI could not process that message right now.");const safe=/insufficient wallet balance|wallet not found|product not found|inactive|confirmation has expired|disabled|authentication|required/i.test(msg)?msg:"Bindawasub AI could not process that message right now.";await send(chatId,"❌ "+safe,true);return}if(d?.available===false){await send(chatId,String(d?.answer||"⚠️ The selected service is currently not available. Please try another service later."),true);return}let aiAnswer=String(d?.answer||"").trim();
  if(String(d?.intent||"").toLowerCase()==="transaction_history"&&Array.isArray(d?.transactions)){
    const rows=d.transactions.slice(0,5).map((tx:any,i:number)=>{
      const details=[tx.product_name||"Purchase",tx.network?String(tx.network).toUpperCase():null,tx.volume||null].filter(Boolean).join(" ");
      const amount=Number(tx.amount||0).toLocaleString("en-NG");
      const status=String(tx.status||"pending").toUpperCase();
      const date=tx.date?new Date(tx.date).toLocaleString("en-NG",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"";
      return (i+1)+". "+details+" — ₦"+amount+" — "+status+" — "+date;
    });
    aiAnswer=rows.length
      ?"Here are your latest "+rows.length+" purchases:\\n\\n"+rows.join("\\n")
      :"You do not have any purchases yet.";
  }const telegramAirtimeIntent=/\b(?:airtime|airtime\s+credit|recharge)\b/i.test(effectiveText)&&/\b(?:buy|purchase|get|want|need|send|give|recharge|airtime|saya|siya)\b/i.test(effectiveText);if(telegramAirtimeIntent){const airtimeUnavailable="📱 Airtime purchases are temporarily unavailable.\n\nWe’re working on connecting a reliable airtime provider.\n\nCustomer Care: @Aliyubdw";await send(chatId,airtimeUnavailable,true);return}const confused=/\b(i (?:do not|don.?t) understand|i(?:\s+)?didn.?t understand|not sure what you mean|cannot understand|can.?t understand|unable to understand|couldn.?t understand|please rephrase|rephrase your request|i can.?t help with that)\b/i.test(aiAnswer);if(aiAnswer&&!confused){
    const transactionId=String(d?.transaction_id||"").trim();
    if(transactionId){
      try{
        const claim=await claimTelegramNotification(db,transactionId);
        if(claim){
          try{
            await send(chatId,aiAnswer,true);
            await completeTelegramNotification(db,transactionId);
          }catch(notificationError){
            await releaseTelegramNotificationClaim(db,transactionId,notificationError instanceof Error?notificationError.message:String(notificationError));
            throw notificationError;
          }
        }
      }catch(notificationError){
        console.error("Telegram transaction notification:",notificationError);
        if(!String(d?.answer||"").trim()) await send(chatId,"❌ The transaction result could not be delivered right now. Please check your transaction history.",true);
      }
    }else{
      await send(chatId,aiAnswer,true);
    }
  }
  if(confused)await send(chatId,"🤔 I didn’t quite understand that.\nPlease choose an option from the menu or rephrase your request.\n\nCustomer Care: @Aliyubdw",true);if(!["product_price","purchase_intent"].includes(String(d?.intent||"").toLowerCase())&&Array.isArray(d?.products)&&d.products.length){const lines=d.products.map((p:any,i:number)=>{const network=p.network_name||p.network||"";const duration=p.duration||(p.validity_type==="fixed"&&p.validity_value&&p.validity_unit?String(p.validity_value)+" "+String(p.validity_unit):p.validity_type==="unlimited"?"Unlimited":"");const details=[network,p.volume,duration].filter(Boolean).join(" • ");return (i+1)+". "+(p.product_name||"Data plan")+" — ₦"+Number(p.selling_price||0).toLocaleString("en-NG")+(details?"\n   "+details:"")});await send(chatId,"📦 Available data plans\n\n"+lines.join("\n\n"),true)}else if(!aiAnswer||confused){if(!confused)await send(chatId,"🤔 I didn’t quite understand that.\nPlease choose an option from the menu or rephrase your request.\n\nCustomer Care: @Aliyubdw",true)}}catch(e){console.error("Telegram background AI:",e);await send(chatId,"❌ The request could not be completed right now. Please check your transaction status before trying again.",true)}};
  const affirmative=/^(yes|yeah|yep|ok|okay|confirm|confirmed|proceed|go ahead|do it|eh|e|naam|toh)\b/i.test(effectiveText);let hasPendingPurchase=false;let pendingConversationId:string|null=null;
  if(affirmative){const {data:pending,error:pendingError}=await db.from("ai_conversations").select("id").eq("user_id",acct.user_id).not("pending_at","is",null).gt("pending_at",new Date(Date.now()-15*60*1000).toISOString()).or("pending_product_id.not.is.null,pending_airtime_amount.not.is.null").order("pending_at",{ascending:false}).limit(1).maybeSingle();if(pendingError)console.error("Telegram pending purchase lookup:",pendingError);hasPendingPurchase=!!pending;pendingConversationId=pending?.id||null}
  if(hasPendingPurchase){await send(chatId,"⏳ Your purchase is being processed. I’ll send you the final result here. Please don’t send the confirmation again.",true);if(typeof EdgeRuntime!=="undefined"&&typeof EdgeRuntime.waitUntil==="function")EdgeRuntime.waitUntil(runAi());else await runAi();return out({success:true,linked:true,processing:true})}
  await runAi();return out({success:true,linked:true,ai:true});
 }catch(e){console.error("telegram-webhook:",e);return out({success:false,error:e instanceof Error?e.message:"Telegram webhook failed."},500)}
});