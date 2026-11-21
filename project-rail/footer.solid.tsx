/** @jsxImportSource @solidjs/web */
import { Provided } from '@/sdk/parts.solid.tsx'
import { BarFooter } from './ui.tsx'

export function Footer(props: { where: 'rail' | 'phone' }) {
  return <Provided input={{ where: props.where }} point={BarFooter} />
}
