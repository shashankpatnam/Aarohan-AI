import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { BookingsProvider } from "./context/BookingsContext.jsx";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <BookingsProvider>
        <App />
      </BookingsProvider>
    </AuthProvider>
  </StrictMode>,
)
