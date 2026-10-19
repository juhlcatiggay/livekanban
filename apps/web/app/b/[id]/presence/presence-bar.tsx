"use client";

import { useState } from "react";
import { MAX_NAME_LENGTH, type Peer } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { IDENTITY_COLORS } from "@/lib/identity";
import { useDismiss } from "@/lib/use-dismiss";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function statusOf(p: Pick<Peer, "idle" | "away">) {
  if (p.away) return "away";
  if (p.idle) return "idle";
  return null;
}

function Avatar({ peer, label }: { peer: Pick<Peer, "name" | "color" | "idle" | "away">; label: string }) {
  const status = statusOf(peer);
  return (
    <span
      title={status ? `${label} (${status})` : label}
      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white transition-opacity dark:border-stone-950 ${
        status ? "opacity-40" : ""
      }`}
      style={{ backgroundColor: peer.color }}
    >
      {initials(peer.name)}
    </span>
  );
}

/** Everyone on the board; your own avatar opens a menu to change your name and color. */
export function PresenceBar() {
  const me = useBoard((s) => s.me);
  const selfPeer = useBoard((s) => s.selfPeer);
  const self = useBoard((s) => s.self);
  const peers = Object.values(useBoard((s) => s.peers));
  const count = peers.length + (me && self ? 1 : 0);

  return (
    <div className="flex items-center gap-2">
      <ul className="flex -space-x-2" aria-label={`${count} people on this board`}>
        {me && self && (
          <li>
            <ProfileMenu>
              <Avatar peer={{ ...me, idle: selfPeer?.idle ?? false, away: false }} label={`${me.name} (you)`} />
            </ProfileMenu>
          </li>
        )}
        {peers.map((p) => (
          <li key={p.connectionId}>
            <Avatar peer={p} label={p.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProfileMenu({ children }: { children: React.ReactNode }) {
  const me = useBoard((s) => s.me)!;
  const setProfile = useBoard((s) => s.setProfile);
  const [name, setName] = useState(me.name);
  const menu = useDismiss();

  const saveName = () => {
    const next = name.trim();
    if (next && next !== me.name) setProfile(next, me.color);
    else setName(me.name);
  };

  return (
    <details ref={menu} className="relative">
      <summary className="cursor-pointer list-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teal-500" aria-label="Your name and color">
        {children}
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900">
        <label className="flex flex-col gap-1 font-medium">
          Your name
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            className="rounded-md border border-stone-300 bg-transparent px-2 py-1 font-normal outline-none focus:border-teal-500 dark:border-stone-700"
          />
        </label>
        <fieldset className="mt-3">
          <legend className="mb-1.5 font-medium">Your color</legend>
          <div className="flex flex-wrap gap-2">
            {IDENTITY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={me.color === c}
                onClick={() => setProfile(me.name, c)}
                className={`h-6 w-6 rounded-full ${me.color === c ? "ring-2 ring-stone-900 ring-offset-2 dark:ring-white dark:ring-offset-stone-900" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </fieldset>
        <p className="mt-3 text-xs text-stone-500">Names are chosen by each visitor and aren&apos;t verified.</p>
      </div>
    </details>
  );
}
