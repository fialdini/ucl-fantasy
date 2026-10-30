import type { Position } from "@/domain/types";
import { POSITION_SHIRT } from "./ui";

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Rosto do jogador (foto da UEFA). Por baixo fica um círculo com as iniciais na cor da posição,
 * que aparece se a foto não existir ou não carregar.
 */
export function PlayerAvatar({ name, photoUrl, position, className = "size-10 text-sm" }: { name: string; photoUrl?: string | null; position: Position; className?: string }) {
  return (
    <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-linear-to-b font-display font-bold ring-2 ring-white/25 ${POSITION_SHIRT[position]} ${className}`}>
      {initials(name)}
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full bg-night-900 object-cover object-top" />
      )}
    </span>
  );
}
