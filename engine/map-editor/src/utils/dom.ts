export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
