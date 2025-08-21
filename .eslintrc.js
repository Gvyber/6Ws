module.exports = {
  // Extend the default create-react-app configuration
  extends: ['react-app'],
  // Define global variables that ESLint should ignore
  globals: {
    __app_id: 'readonly',
    __firebase_config: 'readonly',
    __initial_auth_token: 'readonly',
  },
};