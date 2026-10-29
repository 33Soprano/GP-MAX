/**
 * Firebase Authentication (SDK compat, sem bundler).
 * O Firebase autentica a identidade; os dados operacionais ficam no Supabase.
 */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyAp9ayDGvf8jM7zjlCUGvbQt3AI8vjwMsE",
    authDomain: "gp-max-f60c9.firebaseapp.com",
    projectId: "gp-max-f60c9",
    storageBucket: "gp-max-f60c9.firebasestorage.app",
    messagingSenderId: "201292894624",
    appId: "1:201292894624:web:c8bbe6fc8370b4a727d4c5",
    measurementId: "G-1YQSBSJTH4"
  };

  if (!window.firebase) {
    console.error("Firebase SDK não foi carregado.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  window.gpFirebaseAuth = firebase.auth();
  window.gpFirebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
    console.error("Não foi possível configurar a persistência do Firebase:", error);
  });
})();
