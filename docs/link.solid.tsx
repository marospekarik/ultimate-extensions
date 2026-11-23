/** @jsxImportSource @solidjs/web */
import { Show } from "solid-js";
import type { LinkRenderer } from "@/sdk/solid";
import { docPath } from "./links.ts";
import { docUrl, openDoc } from "./nav.ts";

export const Link: LinkRenderer = (props) => {
  const path = () => docPath(props.href);
  const hash = () => decodeURIComponent(props.href.split("#")[1] ?? "");
  return (
    <Show when={path()} fallback={props.core}>
      {(found) => (
        <a
          href={docUrl(found(), hash()).search + (hash() ? `#${hash()}` : "")}
          onClick={(event) => {
            event.preventDefault();
            openDoc(found(), hash());
          }}
          title={`Open ${found()}${hash() ? `#${hash()}` : ""} in Docs`}
        >
          {props.children}
        </a>
      )}
    </Show>
  );
};
