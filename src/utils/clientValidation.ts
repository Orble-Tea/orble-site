/**
 * Client-side validation utilities
 * Provides real-time validation feedback for form inputs
 */

/**
 * Sanitize input by removing HTML tags and trimming whitespace
 * This is a basic sanitization for client-side use
 */
export function sanitizeInput(value: string): string {
  return value
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/[<>]/g, "") // Remove angle brackets
    .trim();
}

/**
 * Validate required field
 */
export function validateRequired(value: string, fieldName: string): string {
  const sanitized = sanitizeInput(value);
  if (!sanitized || sanitized.length < 2) {
    return `Please enter a valid ${fieldName}.`;
  }
  if (sanitized.length > 100 && fieldName === "name") {
    return "Name must be less than 100 characters.";
  }
  if (sanitized.length > 5000 && fieldName === "message") {
    return "Message must be less than 5000 characters.";
  }
  return "";
}

/**
 * Validate email address
 */
export function validateEmail(value: string): string {
  const sanitized = sanitizeInput(value);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!sanitized) {
    return "Please enter an email address.";
  }
  if (!emailRegex.test(sanitized)) {
    return "Please enter a valid email address.";
  }
  if (sanitized.length > 254) {
    return "Email address is too long.";
  }
  return "";
}

/**
 * Validate message length
 */
export function validateMessage(value: string): string {
  const sanitized = sanitizeInput(value);
  if (!sanitized || sanitized.length < 10) {
    return "Please enter a message (at least 10 characters).";
  }
  if (sanitized.length > 5000) {
    return "Message must be less than 5000 characters.";
  }
  return "";
}