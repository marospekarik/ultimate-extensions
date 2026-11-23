/** @jsxImportSource @solidjs/web */
import { Provided } from '@/sdk/solid'
import { BarFooter } from './ui.solid.tsx'

export function Footer(props: { where: 'rail' | 'phone' }) {
  return <Provided input={{ where: props.where }} point={BarFooter} />
}
