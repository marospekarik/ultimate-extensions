/** @jsxImportSource @solidjs/web */
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";

import { showSurface, useAction, useExtensionUiState } from "@/sdk/solid";
import type { LinkRenderer } from "@/sdk/solid";
import { ListAction } from "./refs.ts";

export const SURFACE = "pull-requests";

const prLink =
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;

/** A link to one of this repository's PRs opens it here; ⌘- or Ctrl-click still opens GitHub. */
export const Link: LinkRenderer = (props) => {
  const match = () => prLink.exec(props.href);
  return (
    <Show when={match()} fallback={props.core}>
      {(found) => (
        <PrLink
          href={props.href}
          repo={found()[1]}
          number={Number(found()[2])}
          core={props.core}
        >
          {props.children}
        </PrLink>
      )}
    </Show>
  );
};

function PrLink(props: {
  href: string;
  repo: string;
  number: number;
  core: JSX.Element;
  children: JSX.Element;
}) {
  const list = useAction(ListAction, null);
  const [, setSelected] = useExtensionUiState<number | null>("selected", null);
  const open = () => {
    const data = list.data();
    return (
      data?.status === "ok" &&
      data.repo === props.repo &&
      data.prs.some((pr) => pr.number === props.number)
    );
  };
  return (
    <Show when={open()} fallback={props.core}>
      <a
        href={props.href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          setSelected(props.number);
          showSurface(SURFACE);
        }}
        rel="noreferrer"
        target="_blank"
        title={`Open PR #${props.number} in PRs (⌘-click: GitHub)`}
      >
        {props.children}
      </a>
    </Show>
  );
}
