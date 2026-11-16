export const reportReasons = {
  spam: '广告或垃圾信息',
  harassment: '辱骂或骚扰',
  hate: '仇恨或暴力',
  privacy: '泄露个人隐私',
  fraud: '诈骗或危险行为',
  copyright: '侵犯著作权',
  inaccurate: '错误或过时信息',
  other: '其他违规',
} as const;

export function reportReasonApplies(
  reason: { enabled: boolean; boards: readonly string[] },
  boards: readonly string[],
) {
  return (
    reason.enabled &&
    (!reason.boards.length || reason.boards.some((board) => boards.includes(board)))
  );
}
