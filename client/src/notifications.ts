export function showGameNotification(message: string, type: 'success' | 'warning' | 'error' = 'success') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    border-radius: 6px;
    color: white;
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 2000;
    opacity: 0;
    transition: opacity 0.3s ease;
    max-width: 400px;
    text-align: center;
  `;

  switch (type) {
    case 'success':
      notification.style.background = 'rgba(76, 175, 80, 0.9)';
      break;
    case 'warning':
      notification.style.background = 'rgba(255, 193, 7, 0.9)';
      break;
    case 'error':
      notification.style.background = 'rgba(244, 67, 54, 0.9)';
      break;
  }

  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '1';
  }, 100);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}
