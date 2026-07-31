// Test IDs for the auth feature (login, register, logout) — consumed via
// React Native's `testID` prop on TouchableOpacity / Pressable / TextInput /
// Button / Switch and friends. Add new keys here as you wire up additional
// auth UI; see ./index.js for the recipe to add a new feature file.
//
// React Native uses `testID` (camelCase, no dash), not `data-testid`:
//   import { LOGIN } from '../constants/testIds';
//   <TouchableOpacity testID={LOGIN.submitButton} onPress={...} />
//   <TextInput testID={LOGIN.emailInput} ... />
//
// Directive:
//   - Keys are camelCase, values are kebab-case shaped as `<feature>-<element>`
//     (or `<feature>-<element>-<qualifier>` when an element repeats). Examples:
//     'login-submit-button', 'cart-quantity-input', 'product-card-image'.
//
// Why kebab-case values: required by qabot's CSS-attribute-style selector
// matcher and the lint rule `emergent(kebab-case-testid-prop)`.

export const LOGIN = {
	emailInput: 'login-email-input',
	passwordInput: 'login-password-input',
	submitButton: 'login-submit-button',
	googleButton: 'login-google-button',
	registerLink: 'login-go-register',
	errorBox: 'login-error',
};

export const REGISTER = {
	backButton: 'register-back-button',
	nameInput: 'register-name-input',
	emailInput: 'register-email-input',
	passwordInput: 'register-password-input',
	submitButton: 'register-submit-button',
	loginLink: 'register-go-login',
	errorBox: 'register-error',
};

export const LOGOUT = {
	button: 'profile-sign-out',
};
