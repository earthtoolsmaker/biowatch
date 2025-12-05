import './assets/main.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import Base from './base'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Base />
  </React.StrictMode>
)

function detectOS() {
  const userAgent = window.navigator.userAgent

  // Check if Windows
  if (userAgent.indexOf('Windows') !== -1) {
    document.body.classList.add('windows-os')
  } else if (userAgent.indexOf('Mac') !== -1) {
    document.body.classList.add('mac-os')
  } else if (userAgent.indexOf('Linux') !== -1) {
    document.body.classList.add('linux-os')
  }
}

detectOS()
