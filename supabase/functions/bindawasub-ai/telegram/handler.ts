export function isInternalTelegramRequest(
  authorization: string,
  serviceRoleKey: string,
  channelHeader: string | null,
  userId: unknown
) {
  return (
    authorization === "Bearer " + serviceRoleKey &&
    channelHeader === "telegram" &&
    typeof userId === "string"
  );
}

export function resolveRequestChannel(isTelegram: boolean, requestedChannel: unknown) {
  return isTelegram
    ? "telegram"
    : String(requestedChannel || "web").toLowerCase();
}
