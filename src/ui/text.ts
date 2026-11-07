/** Keep persisted rule text unchanged; translate vocabulary at the display boundary. */
export function uiText(text: string): string {
  return text
    .replaceAll("公開2巡", "午前・午後の公開行動")
    .replaceAll("1巡2回", "各時間帯2回")
    .replace(/第?1巡(?:目)?/g, "午前")
    .replace(/第?2巡(?:目)?/g, "午後")
    .replaceAll("巡目・手番", "時間帯・手番")
    .replaceAll("通常行動の巡目", "午前・午後の手番")
    .replaceAll("夜露石", "人魚の涙")
    .replaceAll("長期HO", "卒業課題")
    .replaceAll("日次HO", "今日の課題")
    .replaceAll("HO", "課題");
}
