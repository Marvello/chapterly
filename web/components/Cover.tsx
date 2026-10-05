/* eslint-disable @next/next/no-img-element -- covers are remote images from the novel's site */
import { coverHue } from "@/lib/view";

/** A novel's cover, else a placeholder in a hue hashed from the title. Decorative: the title is always shown
 * next to it. className sizes it (and sets the placeholder's font size). */
export default function Cover({ url, title, className = "" }: { url: string | null; title: string; className?: string }) {
  if (url) return <img src={url} alt="" className={`object-cover ${className}`} loading="lazy" referrerPolicy="no-referrer" />;
  return (
    <div aria-hidden className={`flex items-center justify-center overflow-hidden p-1.5 ${className}`}
      style={{ background: `hsl(${coverHue(title)} 35% 30%)` }}>
      <span className="line-clamp-4 break-words hyphens-auto text-center font-serif leading-tight text-white">{title}</span>
    </div>
  );
}
