export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="center-state" role="status">{label}</div>
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="error" role="alert">{message}</div>
}

export function SuccessBanner({ message }: { message: string }) {
  return <div className="success" role="status">{message}</div>
}

export function Empty({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>
}
