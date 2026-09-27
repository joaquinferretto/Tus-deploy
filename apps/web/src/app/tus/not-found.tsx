import { redirect } from 'next/navigation'

export default function TusNotFound(): never {
  redirect('/')
}
