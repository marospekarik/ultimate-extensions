/** @jsxImportSource @solidjs/web */
/** Points other extensions provide into the PRs surface. */
import type { JSX } from "@solidjs/web";
import { definePoint } from "@/sdk/solid";

/**
 * A quiet mark about one PR from another extension (`pr-fit` provides its fit verdict): `row` sits among a list row's
 * tags, `detail` is a line under the PR's title. Undefined or null shows nothing.
 */
export const PrMark = definePoint<
  { number: number; place: "row" | "detail" },
  JSX.Element
>("pull-requests.mark");
