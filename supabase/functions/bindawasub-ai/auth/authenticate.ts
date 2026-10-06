export async function authenticateRequest(req: Request, supabase: any, isInternalTelegramRequest: boolean) {
  if (isInternalTelegramRequest) return { authUser: null, isInternalTelegramRequest: true };
  const authorization = req.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return new Response(JSON.stringify({success:false,error:"Authentication required."}), {status:401,headers:{"Content-Type":"application/json"}});
  const {data:{user:verifiedUser},error:authError}=await supabase.auth.getUser(accessToken);
  if (authError || !verifiedUser) return new Response(JSON.stringify({success:false,error:"Invalid or expired authentication token."}), {status:401,headers:{"Content-Type":"application/json"}});
  return {authUser:verifiedUser,isInternalTelegramRequest:false};
}