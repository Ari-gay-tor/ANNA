import { Suspense } from "react";
import { ChatApp } from "@/components/ChatApp";

// useSearchParams (the ?c=<id> selection) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChatApp />
    </Suspense>
  );
}
