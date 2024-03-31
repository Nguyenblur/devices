process.on('uncaughtException', error => console.error('Unhandled Exception:', error));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection:', reason));

const moment = require("moment-timezone");
const { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } = require("fs-extra");
const { join, resolve } = require("path");
const { execSync } = require('child_process');
const logger = require("./main/utils/log");
const login = require("facebook-chat-api"); 
const axios = require("axios");
const listPackage = JSON.parse(readFileSync('./package.json')).dependencies;
const listbuiltinModules = require("module").builtinModules;

global.client = {
    commands: new Map(), events: new Map(), cooldowns: new Map(), eventRegistered: [],
    handleSchedule: [], handleReaction: [], handleReply: [], mainPath: process.cwd(), configPath: "",
    getTime: function (option) {
        switch (option) {
            case "seconds": return `${moment.tz("Asia/Ho_Chi_minh").format("ss")}`;
            case "minutes": return `${moment.tz("Asia/Ho_Chi_minh").format("mm")}`;
            case "hours": return `${moment.tz("Asia/Ho_Chi_minh").format("HH")}`;
            case "date": return `${moment.tz("Asia/Ho_Chi_minh").format("DD")}`;
            case "month": return `${moment.tz("Asia/Ho_Chi_minh").format("MM")}`;
            case "year": return `${moment.tz("Asia/Ho_Chi_minh").format("YYYY")}`;
            case "fullHour": return `${moment.tz("Asia/Ho_Chi_minh").format("HH:mm:ss")}`;
            case "fullYear": return `${moment.tz("Asia/Ho_Chi_minh").format("DD/MM/YYYY")}`;
            case "fullTime": return `${moment.tz("Asia/Ho_Chi_minh").format("HH:mm:ss DD/MM/YYYY")}`;
        }
    }
};

global.data = {
    threadInfo: new Map(), threadData: new Map(), userName: new Map(), userBanned: new Map(),
    threadBanned: new Map(), commandBanned: new Map(), threadAllowNSFW: [], allUserID: [],
    allCurrenciesID: [], allThreadID: []
};

global.utils = require("./main/utils");
global.nodemodule = {}; global.config = {}; global.configModule = {}; global.moduleData = []; global.language = {};

function readConfigFile(configPath) {
    try {
        if (existsSync(configPath)) return require(configPath);
        else if (existsSync(configPath.replace(/\.json/g,"") + ".temp")) {
            const tempConfig = readFileSync(configPath.replace(/\.json/g,"") + ".temp", 'utf-8');
            logger.loader(`Found: ${configPath.replace(/\.json/g,"") + ".temp"}`);
            return JSON.parse(tempConfig);
        } else throw new Error("Config file not found.");
    } catch (error) {
        logger.loader(`Error reading config file: ${error.message}`, 'error');
        throw error;
    }
}
try {
    global.client.configPath = join(global.client.mainPath, "main/config.json");
    const configValue = readConfigFile(global.client.configPath);
    for (const key in configValue) {
        global.config[key] = configValue[key];
    }
} catch {
    return logger.loader("Không thể tải tệp cấu hình!", "error");
}

const { sequelize } = require("./main/brain/database");
writeFileSync(global.client.configPath + ".temp", JSON.stringify(global.config, null, 4), 'utf8');

const langFile = (readFileSync(`${__dirname}/main/languages/${global.config.language || "en"}.lang`, { encoding: 'utf-8' })).split(/\r?\n|\r/);
const langData = langFile.filter(item => item.indexOf('#') != 0 && item != '');

for (const item of langData) {
    const getSeparator = item.indexOf('=');
    const itemKey = item.slice(0, getSeparator);
    const itemValue = item.slice(getSeparator + 1, item.length);
    const head = itemKey.slice(0, itemKey.indexOf('.'));
    const key = itemKey.replace(head + '.', '');
    const value = itemValue.replace(/\\n/gi, '\n');
    if (!global.language[head]) {
       global.language[head] = {};
    }
    global.language[head][key] = value;
}

global.getText = function (...args) {
    const langText = global.language;    
    if (!langText.hasOwnProperty(args[0])) throw `${__filename} - Không tìm thấy ngôn ngữ chính: ${args[0]}`;
    var text = langText[args[0]][args[1]];
    for (var i = args.length - 1; i > 0; i--) {
        const regEx = RegExp(`%${i}`, 'g');
        text = text.replace(regEx, args[i + 1]);
    }
    return text;
};

try {
    var appStateFile = resolve(join(global.client.mainPath, global.config.APPSTATEPATH || "appstate.json"));
    var appState = require(appStateFile);
} catch {
    return logger.loader(global.getText("mirai", "notFoundPathAppstate"), "error");
}

function onBot({ models: botModel }) {
    const loginData = {};
    loginData['appState'] = appState;

    login(loginData, async (loginError, loginApiData) => {
        if (loginError) {
            return logger(JSON.stringify(loginError), `ERROR`);
        }

        loginApiData.setOptions(global.config.FCAOption);
        writeFileSync(appStateFile, JSON.stringify(loginApiData.getAppState(), null, '\x09'));
        global.client.api = loginApiData;
        global.config.version = '1.2.14';
        global.client.timeStart = new Date().getTime();

        function loadModules(moduleType, folderPath) {
            const modules = readdirSync(global.client.mainPath + folderPath).filter(
                (module) => module.endsWith('.js') && !global.config[`${moduleType}Disabled`].includes(module)
            );

            for (const moduleName of modules) {
                try {
                    const module = require(global.client.mainPath + folderPath + '/' + moduleName);

                    if (!module.config || !module.run) {
                        throw new Error(global.getText('mirai', 'errorFormat'));
                    }

                    if (global.client[`${moduleType}s`].has(module.config.name || '')) {
                        throw new Error(global.getText('mirai', 'nameExist'));
                    }

                    if (module.config.dependencies && typeof module.config.dependencies == 'object') {
                        for (const reqDependency in module.config.dependencies) {
                            const reqDependencyPath = join(__dirname, 'nodemodules', 'node_modules', reqDependency);
                            try {
                                if (!global.nodemodule.hasOwnProperty(reqDependency)) {
                                    if (listPackage.hasOwnProperty(reqDependency) || listbuiltinModules.includes(reqDependency)) global.nodemodule[reqDependency] = require(reqDependency);
                                    else global.nodemodule[reqDependency] = require(reqDependencyPath);
                                } else '';
                            } catch {
                                let check = false;
                                let isError;
                                logger.loader(global.getText('mirai', 'notFoundPackage', reqDependency, module.config.name), 'warn');
                                execSync(`npm --package-lock false --save install ${reqDependency}${(module.config.dependencies[reqDependency] == '*' || module.config.dependencies[reqDependency] == '') ? '' : `@${module.config.dependencies[reqDependency]}`}`, { 'stdio': 'inherit', 'env': process['env'], 'shell': true, 'cwd': join(__dirname, 'nodemodules') });

                                for (let i = 1; i <= 3; i++) {
                                    try {
                                        require['cache'] = {};
                                        if (listPackage.hasOwnProperty(reqDependency) || listbuiltinModules.includes(reqDependency)) global['nodemodule'][reqDependency] = require(reqDependency);
                                        else global['nodemodule'][reqDependency] = require(reqDependencyPath);
                                        check = true;
                                        break;
                                    } catch (error) { isError = error; }
                                    if (check || !isError) break;
                                }

                                if (!check || isError) throw global.getText('mirai', 'cantInstallPackage', reqDependency, module.config.name, isError);
                            }
                        }
                    }

                    if (module.config.envConfig) {
                        try {
                            for (const envConfig in module.config.envConfig) {
                                if (typeof global.configModule[module.config.name] == 'undefined') global.configModule[module.config.name] = {};
                                if (typeof global.config[module.config.name] == 'undefined') global.config[module.config.name] = {};
                                if (typeof global.config[module.config.name][envConfig] !== 'undefined') global['configModule'][module.config.name][envConfig] = global.config[module.config.name][envConfig];
                                else global.configModule[module.config.name][envConfig] = module.config.envConfig[envConfig] || '';
                                if (typeof global.config[module.config.name][envConfig] == 'undefined') global.config[module.config.name][envConfig] = module.config.envConfig[envConfig] || '';
                            }
                        } catch (error) {}
                    }

                    if (module.onLoad) {
                        try {
                            const moduleData = {};
                            moduleData.api = loginApiData;
                            moduleData.models = botModel;
                            module.onLoad(moduleData);
                        } catch (_0x20fd5f) {
                            throw new Error(global.getText('mirai', 'cantOnload', module.config.name, JSON.stringify(_0x20fd5f)), 'error');
                        };
                    }

                    if (module.handleEvent) global.client.eventRegistered.push(module.config.name);
                    global.client[`${moduleType}s`].set(module.config.name, module);

                } catch (error) {}
            }
        }

        loadModules('command', '/modules/commands', 'name');
        loadModules('event', '/modules/events', 'name');

        logger.loader(global.getText('mirai', 'finishLoadModule', global.client.commands.size, global.client.events.size));
        logger.loader(`Thời gian khởi động: ${((Date.now() - global.client.timeStart) / 1000).toFixed()}s`);
        logger.loader('===== [ ' + (Date.now() - global.client.timeStart) + 'ms ] =====');
        writeFileSync(global.client['configPath'], JSON.stringify(global.config, null, 4), 'utf8');
        unlinkSync(global.client.configPath + '.temp');

        const listenerData = {};
        listenerData.api = loginApiData;
        listenerData.models = botModel;

        const listener = require('./SystemData/listen')(listenerData);

        function listenerCallback(error, message) {
            if (error) {
                return logger(global.getText('mirai', 'handleListenError', JSON.stringify(error)), 'error');
            }

            if (['presence', 'typ', 'read_receipt'].some((data) => data == message.type)) {
                return;
            }

            if (global.config.DeveloperMode == true) {
                console.log(message);
            }

            return listener(message);
        }

        global.handleListen = loginApiData.listenMqtt(listenerCallback);
        try {
        } catch (error) {
            return 
        };
    });
}


(async () => {
  try {
      global.client.loggedMongoose = true;
      const { Model, DataTypes, Sequelize } = require("sequelize");
      const sequelize2 = new Sequelize({
          dialect: "sqlite",
          host: __dirname + '/main/brain/antists.sqlite',
          logging: false
      });
      class DataModel extends Model { }
      DataModel.init({
          threadID: {
              type: DataTypes.STRING,
              primaryKey: true
          },
          data: {
              type: DataTypes.JSON,
              defaultValue: {}
          }
      }, {
          sequelize: sequelize2,
          modelName: "antists"
      });
      DataModel.findOneAndUpdate = async function (filter, update) {
          const doc = await this.findOne({
              where: filter
          });
          if (!doc)
              return null;
          Object.keys(update).forEach(key => doc[key] = update[key]);
          await doc.save();
          return doc;
      }
      global.modelAntiSt = DataModel;
      await sequelize2.sync({ force: false });

      await sequelize.authenticate();
      const authentication = {
          Sequelize: Sequelize,
          sequelize: sequelize
      };
      const models = require('./main/brain/database/model')(authentication);
      const botData = {
          models: models
      };
      onBot(botData);
  } catch (error) {
    global.client.loggedMongoose = false;
    logger.loader('Không thể kết nối dữ liệu ANTI SETTING', '[ CONNECT ]');
    console.error('Error:', error);
  }
})();

process.on('unhandledRejection', (err, p) => {});