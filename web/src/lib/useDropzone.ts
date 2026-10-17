import { useCallback, useState, type DragEvent } from "react";

// Minimal drag-and-drop file hook. Spread `dropProps` on the drop target; use
// `dragging` to highlight it. Only the first dropped file is used.
export function useDropzone(onFile: (file: File) => void, accept?: (file: File) => boolean) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragging(true);
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    // Ignore leave events bubbling from children still inside the zone.
    if (e.currentTarget === e.target) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && (!accept || accept(file))) onFile(file);
    },
    [onFile, accept],
  );

  return { dragging, dropProps: { onDragOver, onDragLeave, onDrop } };
}
