/** @jsxImportSource @solidjs/web */
import { Provided } from '@/sdk/parts.solid.tsx'
import { PrMark } from './ui.tsx'

export function Marks(props: { number: number; place: 'row' | 'detail' }) {
  return <Provided input={{ number: props.number, place: props.place }} point={PrMark} />
}
