/** Keep persisted rule text unchanged; translate vocabulary at the display boundary. */
export function uiText(text: string): string {
  return text
    .replaceAll("夜露石", "人魚の涙")
    .replaceAll("長期HO", "卒業課題")
    .replaceAll("日次HO", "今日の課題")
    .replaceAll("HO", "課題");
}
