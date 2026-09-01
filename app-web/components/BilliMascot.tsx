import { BILLI_DATA_URL } from "./billiAsset";

type BilliMood = "idle" | "scan" | "success";
type BilliSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<BilliSize, string> = {
  sm: "w-16",
  md: "w-24",
  lg: "w-36",
};

/**
 * A deliberately small, contextual delight — Billi appears at moments where
 * the system is doing work or celebrating a completed task, never as a
 * floating distraction over a form. CSS handles the lightweight motion so no
 * WebGL, video download, or timer-driven React state is needed.
 */
export default function BilliMascot({
  mood = "idle",
  size = "md",
  className = "",
  speech,
}: {
  mood?: BilliMood;
  size?: BilliSize;
  className?: string;
  speech?: string;
}) {
  const description = mood === "scan" ? "น้องบิลลี่กำลังอ่านเอกสาร" : mood === "success" ? "น้องบิลลี่ยินดีด้วย" : "น้องบิลลี่";

  return (
    <div className={`billi-mascot billi-mascot--${mood} ${SIZE_CLASS[size]} ${className}`} role="img" aria-label={description}>
      {/* The compact embedded PNG avoids a separate request at the small sizes
          Billi is shown, and keeps the mascot available in every deploy. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BILLI_DATA_URL} alt="" width={400} height={444} className="h-auto w-full" />
      {speech && <span className="billi-mascot__speech">{speech}</span>}
      {mood === "success" && <span className="billi-mascot__spark" aria-hidden="true">✦</span>}
    </div>
  );
}
