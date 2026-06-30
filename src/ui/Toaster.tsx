import { useEffect, useRef, useState } from "react";
import { subscribeToasts } from "./toast";

/** Renders the bottom-center toast pill. Mount once near the app root. */
export function Toaster() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return subscribeToasts((m) => {
      setMsg(m);
      setShow(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShow(false), 2000);
    });
  }, []);

  return <div className={"toast" + (show ? " show" : "")}>{msg}</div>;
}
