import { Composition } from 'remotion'
import { Bench } from './Bench'

export const Root = () => (
  <Composition
    id="Bench"
    component={Bench}
    durationInFrames={120}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ repeats: 1 }}
  />
)
