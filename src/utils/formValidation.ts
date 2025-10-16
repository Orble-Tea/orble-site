import DOMPurify from "isomorphic-dompurify";

/**
 * Server-side form validation utilities
 * Provides sanitization and validation for contact form data
 */

export interface ContactFormData {
  name: string;
  email: string;
  message: string;
}

export interface ValidationErrors {
  name: string;
  email: string;
  message: string;
}

/**
 * Sanitize form data using DOMPurify
 * Removes any potentially harmful HTML/script tags
 */
export function sanitizeFormData(data: ContactFormData): ContactFormData {
  return {
    name: DOMPurify.sanitize(data.name.trim()),
    email: DOMPurify.sanitize(data.email.trim()),
    message: DOMPurify.sanitize(data.message.trim()),
  };
}

/**
 * Validate contact form data
 * Returns an object with error messages for each field
 */
export function validateContactForm(data: ContactFormData): ValidationErrors {
  const errors: ValidationErrors = {
    name: "",
    email: "",
    message: "",
  };

  // Validate name
  if (!data.name || data.name.length < 2) {
    errors.name = "Please enter a valid name (at least 2 characters).";
  } else if (data.name.length > 100) {
    errors.name = "Name must be less than 100 characters.";
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!data.email || !emailRegex.test(data.email)) {
    errors.email = "Please enter a valid email address.";
  } else if (data.email.length > 254) {
    errors.email = "Email address is too long.";
  }

  // Validate message
  if (!data.message || data.message.length < 10) {
    errors.message = "Please enter a message (at least 10 characters).";
  } else if (data.message.length > 5000) {
    errors.message = "Message must be less than 5000 characters.";
  }

  return errors;
}

/**
 * Check if validation errors object has any errors
 */
export function hasValidationErrors(errors: ValidationErrors): boolean {
  return Object.values(errors).some((error) => error !== "");
}