import { useEffect, useSyncExternalStore } from "react";
import {
  HOST_MOVE_ARM_MS,
  getHostMove,
  hostMoveArmedFor,
  nextHostMove,
  setHostMove,
  subscribeHostMove,
} from "@/lib/together/host-move";
import { useTogether } from "@/lib/together/provider";
import { useView } from "@/lib/view";

/** Tells the room the host left when "play next" from the end screen never reaches a player. */
export function TogetherHostMoveGuard() {
  const move = useSyncExternalStore(subscribeHostMove, getHostMove);
  const { picker, player } = useView();
  const { snapshot, clientId, publishState, notifyHostLeaving, clearInvite } = useTogether();
  const isHost = snapshot.state === "joined" && snapshot.hostClientId === clientId;

  useEffect(() => {
    if (move === "idle") return;
    const step = () => {
      const next = nextHostMove(getHostMove(), { picker, player }, hostMoveArmedFor());
      setHostMove(next.state);
      if (!next.teardown || !isHost) return;
      publishState({
        mediaId: null,
        mediaTitle: null,
        episode: null,
        posterUrl: null,
        positionSeconds: 0,
        playing: false,
      });
      notifyHostLeaving();
      clearInvite();
    };
    step();
    if (getHostMove() !== "armed") return;
    const id = window.setTimeout(step, HOST_MOVE_ARM_MS);
    return () => window.clearTimeout(id);
  }, [move, picker, player, isHost, publishState, notifyHostLeaving, clearInvite]);

  return null;
}
