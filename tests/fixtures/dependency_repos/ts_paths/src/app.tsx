import Button from '@/components/Button'
import { cap } from '~utils'
import { cfg } from 'src/config'
import missing from '@/nope'
import React from 'react'
export const App = () => <Button label={cap(cfg.name)} />
