import '../assets/main.css'

import ReactDOM from 'react-dom/client'
import { MatriarchRoot } from './root'

// Why: the portal is a THIN client — it never installs the full editor preload
// or loads the editor App. It constructs a WebRuntimeClient directly (via the
// Orca backend adapter), so pairing this entry never force-loads the IDE.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<MatriarchRoot />)
