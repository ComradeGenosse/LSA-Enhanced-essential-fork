const EXTERNAL_LINKS = Object.freeze({
  lsaPro: "https://www.patreon.com/cw/LosSantosAlive",
  geminiApiKeys: "https://aistudio.google.com/api-keys",
  lspdfrBundle: "https://www.lcpdfr.com/downloads/gta5mods/g17media/7792-lspd-first-response/",
  damageTrackingFramework: "https://www.lcpdfr.com/downloads/gta5mods/scripts/42767-damage-tracker-framework/",
  policingRedefined: "https://www.lcpdfr.com/downloads/gta5mods/scripts/52191-policing-redefined/",
  ragePluginHookOnly: "https://cdn.discordapp.com/attachments/954822498329981009/1528485821995286690/RAGEPluginHook_1_131_1424_17745.zip?ex=6a7ccb59&is=6a7b79d9&hm=34eaddffa3bbcb553898b70e02cd6c22071943aaa05c42fbd431e96a9aae9b1d&"
});

const ALLOWED_EXTERNAL_URLS = new Set(Object.values(EXTERNAL_LINKS));

module.exports = {
  EXTERNAL_LINKS,
  ALLOWED_EXTERNAL_URLS
};
