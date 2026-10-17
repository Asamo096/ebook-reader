import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/library.css'
import './styles/reader.css'

createRoot(document.getElementById('root')!).render(<App />)
