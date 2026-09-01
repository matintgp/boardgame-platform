const SRC: Record<"token" | "lock" | "raze", string> = {
  token: "/rokugan/sounds/token.mp3",
  lock: "/rokugan/sounds/lock.mp3",
  raze: "/rokugan/sounds/raze.mp3",
};

function play(kind: keyof typeof SRC, volume = 0.55) {
  try {
    const a = new Audio(SRC[kind]);
    a.volume = volume;
    void a.play();
  } catch {
    /* ignore */
  }
}

export function playRokuganToken() {
  play("token", 0.45);
}
export function playRokuganLock() {
  play("lock", 0.7);
}
export function playRokuganRaze() {
  play("raze", 0.8);
}
