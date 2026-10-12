import { useState } from "react";
import { AstraAvatar, type AstraMood } from "./AstraAvatar";

/** Versão inicial da Astra: o chat de verdade chega na Etapa 3. */
export function AstraDock() {
  const [mood, setMood] = useState<AstraMood>("happy");
  return (
    <div className="astra-dock">
      <div className="astra-bubble glass" onMouseEnter={() => setMood("search")} onMouseLeave={() => setMood("happy")}>
        <b>Astra</b>
        <p>Oi! Eu vou te ajudar a achar o que está ocupando espaço. Clique nos astros para explorar.</p>
      </div>
      <AstraAvatar mood={mood} size={132} />
    </div>
  );
}
