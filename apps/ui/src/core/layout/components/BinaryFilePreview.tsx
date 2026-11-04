import { useQuery } from "@tanstack/react-query";
import { BinaryFileCard, BlobDiffSkeleton, ImageFileView } from "@/core/git/components/BinaryDiffView";

/**
 * A file tab for an image or other binary file: the picture with its size,
 * or a card with the file type and size, instead of "cannot be opened" (#610).
 */
export const BinaryFilePreview = ({ source, title }: { source?: string; title: string }) => {
  const { data: blob, isLoading } = useQuery({
    queryKey: ["files:blob", source],
    queryFn: async () => (source ? (await window.electron?.files.readBlob(source)) ?? null : null),
    enabled: !!source,
    staleTime: 0,
  });

  if (isLoading) return <BlobDiffSkeleton columns={1} />;
  if (!blob?.exists) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-comment select-none">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs">This file could not be read.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full min-h-0">
      {blob.dataUrl ? <ImageFileView blob={blob} label={title} note={blob.label} /> : <BinaryFileCard base={blob} compare={blob} filePath={source ?? title} single />}
    </div>
  );
};
