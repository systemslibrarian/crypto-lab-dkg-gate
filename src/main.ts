import './styles.css'
import { mountCeremony } from './ui/ceremony.ts'
import { mountThreshold } from './ui/threshold.ts'
import { mountBias } from './ui/bias.ts'

const need = (id: string): HTMLElement => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing mount point #${id}`)
  return node
}

const threshold = mountThreshold(need('exhibit-threshold'))
mountCeremony(need('exhibit-ceremony'), (t) => threshold.setTranscript(t))
mountBias(need('exhibit-bias'))
