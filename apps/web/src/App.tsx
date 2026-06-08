import { BrowserRouter, Routes, Route, Link, Outlet } from 'react-router-dom'
import Landing from './pages/Landing'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import './App.css'

function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="brand">Priveat</Link>
        <nav className="nav">
          <Link to="/privacy">プライバシーポリシー</Link>
          <Link to="/terms">利用規約</Link>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <small>
          サポート: <a href="mailto:retwpay@gmail.com">retwpay@gmail.com</a>
          <br />
          © 2026 Priveat
        </small>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
