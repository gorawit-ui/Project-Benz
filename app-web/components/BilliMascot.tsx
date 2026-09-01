import Image from "next/image";

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
}: {
  mood?: BilliMood;
  size?: BilliSize;
  className?: string;
}) {
  const description = mood === "scan" ? "น้องบิลลี่กำลังอ่านเอกสาร" : mood === "success" ? "น้องบิลลี่ยินดีด้วย" : "น้องบิลลี่";

  return (
    <div className={`billi-mascot billi-mascot--${mood} ${SIZE_CLASS[size]} ${className}`} role="img" aria-label={description}>
      <Image src="/billi.png" alt="" width={400} height={444} sizes="(max-width: 640px) 96px, 144px" className="h-auto w-full" />
      {mood === "scan" && <span className="billi-mascot__scan-ring" aria-hidden="true" />}
      {mood === "success" && <span className="billi-mascot__spark" aria-hidden="true">✦</span>}
    </div>
  );
}
