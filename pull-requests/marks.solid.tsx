/** @jsxImportSource @solidjs/web */
import { Provided } from "@/sdk/solid";
import { PrMark } from "./ui.solid.tsx";

export function Marks(props: { number: number; place: "row" | "detail" }) {
  return (
    <Provided
      input={{ number: props.number, place: props.place }}
      point={PrMark}
    />
  );
}
