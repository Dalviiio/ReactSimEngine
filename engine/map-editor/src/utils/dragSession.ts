/** Attache des listeners temporaires sur window pour la durée d'un drag (souris pouvant sortir de l'élément). */
export function startWindowDrag(onMove: (e: MouseEvent) => void, onEnd?: () => void): void {
  const handleMove = (e: MouseEvent) => onMove(e);
  const handleUp = () => {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
    onEnd?.();
  };
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleUp);
}
