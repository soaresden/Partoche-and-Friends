// Configuration de Partoche and Friends.
//
// pcloudClientId : identifiant d'une « appli » pCloud, à créer une fois sur https://docs.pcloud.com/my_apps/
//   (Redirect URIs : l'adresse exacte de cette page, ex. https://soaresden.github.io/MSCZ-and-Friends/
//    et http://localhost:53682/ pour tester sur le PC). Sans identifiant, seul le mode démo est proposé.
// relay : relais public ntfy.sh (présence + « j'ai changé quelque chose »), messages chiffrés avec la clé du collectif.
// folder : nom du dossier créé dans le pCloud de chaque membre.
window.MAF_CONFIG = window.MAF_CONFIG || {
  pcloudClientId: '',
  relay: 'https://ntfy.sh/',
  folder: 'Partoche and Friends',
}
