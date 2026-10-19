import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BOARD_ID_RE } from "@livekanban/protocol";
import { Board } from "./board";

export const metadata: Metadata = {
  title: "Board · LiveKanban",
  robots: { index: false, follow: false },
};

export default function BoardPage({ params }: PageProps<"/b/[id]">) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      {params.then(({ id }) => {
        if (!BOARD_ID_RE.test(id)) notFound();
        return <Board boardId={id} />;
      })}
    </Suspense>
  );
}

function BoardSkeleton() {
  return <div className="flex flex-1 items-center justify-center text-gray-500">Loading board…</div>;
}
