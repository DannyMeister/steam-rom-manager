import { Injectable } from '@angular/core';
import { Http } from '@angular/http';
import { UserConfiguration, ParsedUserConfiguration } from '../models';
import { LoggerService } from './logger.service';
import { SettingsService } from './settings.service';
import { FuzzyService } from './fuzzy.service';
import { ImageProviderService } from './image-provider.service';
import { FileParser, VariableParser } from '../lib';
import { availableProviders } from '../lib/image-providers';
import { BehaviorSubject } from "rxjs";
import { gApp } from "../app.global";
import * as fs from 'fs-extra';
import * as _ from 'lodash';
import * as paths from '../../shared/paths'

@Injectable()
export class ParsersService {
    private fileParser: FileParser;
    private userConfigurations: BehaviorSubject<UserConfiguration[]>;
    private defaultValues: UserConfiguration;

    constructor(private fuzzyService: FuzzyService, private loggerService: LoggerService, private settingService: SettingsService, private http: Http) {
        this.fileParser = new FileParser(this.fuzzyService);
        this.userConfigurations = new BehaviorSubject<UserConfiguration[]>([]);
        this.defaultValues = {
            parserType: '',
            configTitle: '',
            steamCategory: '',
            executableLocation: '',
            romDirectory: '',
            steamDirectory: '',
            userAccounts: { skipWithMissingDataDir: true, specifiedAccounts: '' },
            parserInputs: {},
            executableArgs: '',
            appendArgsToExecutable: false,
            localImages: '',
            onlineImageQueries: '${${fuzzyTitle}}',
            imageProviders: availableProviders(),
            titleModifier: '${title}',
            fuzzyMatch: { use: true, removeCharacters: true, removeBrackets: true },
            advanced: false,
            enabled: true
        };
        this.readUserConfigurations();
    }

    get lang() {
        return gApp.lang.parsers.service;
    }

    getUserConfigurations() {
        return this.userConfigurations.asObservable();
    }

    getUserConfigurationsArray() {
        return this.userConfigurations.getValue();
    }

    getDefaultValues() {
        return this.defaultValues;
    }

    saveConfiguration(config: UserConfiguration) {
        let userConfigurations = this.userConfigurations.getValue();
        userConfigurations = userConfigurations.concat(config);
        this.userConfigurations.next(userConfigurations);
        this.saveUserConfigurations();
    }

    swapIndex(currentIndex: number, newIndex: number) {
        let userConfigurations = this.userConfigurations.getValue();
        var temp = userConfigurations[currentIndex];
        userConfigurations[currentIndex] = userConfigurations[newIndex];
        userConfigurations[newIndex] = temp;
        this.userConfigurations.next(userConfigurations);
        this.saveUserConfigurations();
    }

    updateConfiguration(config: UserConfiguration, index: number) {
        let userConfigurations = this.userConfigurations.getValue();
        userConfigurations[index] = config;
        this.userConfigurations.next(userConfigurations);
        this.saveUserConfigurations();
    }

    deleteConfiguration(index: number) {
        let userConfigurations = this.userConfigurations.getValue();
        userConfigurations.splice(index, 1);
        this.userConfigurations.next(userConfigurations);
        this.saveUserConfigurations();
    }

    getAvailableParsers() {
        return this.fileParser.getAvailableParsers();
    }

    getParser(parser: string) {
        return this.fileParser.getParser(parser);
    }

    executeFileParser(...configs: UserConfiguration[]) {
        let invalidConfigTitles: string[] = [];
        let skipped: string[] = [];
        let validConfigs: UserConfiguration[] = [];

        if (configs.length === 0) {
            let configArray = this.getUserConfigurationsArray();
            for (let i = 0; i < configArray.length; i++) {
                if (configArray[i].enabled)
                    configs.push(configArray[i]);
                else
                    skipped.push(configArray[i].configTitle);
            }
        }

        configs = _.cloneDeep(configs);

        for (let i = 0; i < configs.length; i++) {
            if (this.isConfigurationValid(configs[i]))
                validConfigs.push(configs[i]);
            else
                invalidConfigTitles.push(configs[i].configTitle || this.lang.text.noTitle);
        }

        return this.fileParser.executeFileParser(validConfigs).then((parsedData) => {
            return { parsedData: parsedData, invalid: invalidConfigTitles, skipped: skipped };
        });
    }

    validate(key: string, data: any) {
        switch (key) {
            case 'parserType':
                {
                    let availableParsers = this.getAvailableParsers();
                    return (availableParsers.indexOf(data) !== -1) ? null : this.lang.validationErrors.parserType;
                }
            case 'configTitle':
                return data ? null : this.lang.validationErrors.configTitle;
            case 'steamCategory':
                return this.validateVariableParserString(data || '');
            case 'executableLocation':
                return this.validatePath(data || '', false) ? null : this.lang.validationErrors.executable;
            case 'romDirectory':
                return this.validatePath(data || '', true) ? null : this.lang.validationErrors.romDir;
            case 'steamDirectory':
                return this.validatePath(data || '', true) ? null : this.lang.validationErrors.steamDir;
            case 'specifiedAccounts':
                return this.validateVariableParserString(data || '');
            case 'parserInputs':
                {
                    let availableParser = this.getParser(data['parser']);
                    if (availableParser) {
                        if (availableParser.inputs === undefined)
                            return this.lang.validationErrors.parserInput.noInput;
                        else if (availableParser.inputs[data['input']] === undefined)
                            return this.lang.validationErrors.parserInput.inputNotAvailable__i.interpolate({ name: data['input'] });
                        else if (availableParser.inputs[data['input']].forcedInput || availableParser.inputs[data['input']].validationFn === undefined)
                            return null;
                        else
                            return availableParser.inputs[data['input']].validationFn(data['inputData']);
                    }
                    else
                        return this.lang.validationErrors.parserInput.incorrectParser;
                }
            case 'onlineImageQueries':
                return this.validateVariableParserString(data || '');
            case 'imageProviders':
                return _.isArray(data) ? null : this.lang.validationErrors.imageProviders;
            case 'titleModifier':
                return (!data || data.search(/\${title}/i) === -1) ? this.lang.validationErrors.titleModifier : null;
            default:
                return this.lang.validationErrors.unhandledValidationKey;
        }
    }

    private validateVariableParserString(input: string) {
        if (input.length === 0 || new VariableParser('${', '}', input).isValid())
            return null;
        else
            return this.lang.validationErrors.variableString;
    }

    private validatePath(fsPath: string, checkForDirectory: boolean) {
        try {
            let path = fs.statSync(fsPath);
            return checkForDirectory ? path.isDirectory() : path.isFile();
        } catch (e) {
            return false;
        }
    }

    isConfigurationValid(config: UserConfiguration) {
        let simpleValidations: string[] = [
            'parserType', 'configTitle', 'steamCategory',
            'executableLocation', 'romDirectory', 'steamDirectory',
            'specifiedAccounts', 'onlineImageQueries', 'titleModifier',
            'imageProviders'
        ];

        for (let i = 0; i < simpleValidations.length; i++) {
            if (this.validate(simpleValidations[i], config[simpleValidations[i]]) !== null)
                return false;
        }

        let availableParser = this.getParser(config.parserType);
        if (availableParser.inputs !== undefined) {
            let parserInputs = config.parserInputs;
            for (let inputName in availableParser.inputs) {
                if (this.validate('parserInputs', { parser: config.parserType, input: inputName, inputData: parserInputs[inputName] }) !== null)
                    return false;
            }
        }

        return true;
    }

    private saveUserConfigurations() {
        return new Promise<UserConfiguration[]>((resolve, reject) => {
            fs.outputFile(paths.userConfigurations, JSON.stringify(this.userConfigurations.getValue(), null, 4), (error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        }).then().catch((error) => {
            this.loggerService.error(this.lang.error.savingConfiguration, { invokeAlert: true, alertTimeout: 5000 });
            this.loggerService.error(error);
        });
    }

    private readUserConfigurations() {
        return new Promise<UserConfiguration[]>((resolve, reject) => {
            fs.readFile(paths.userConfigurations, 'utf8', (error, data) => {
                try {
                    if (error) {
                        if (error.code === 'ENOENT')
                            resolve([]);
                        else
                            reject(error);
                    }
                    else
                        resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).then((data) => {
            let validateConfigs: UserConfiguration[] = [];
            for (let i = 0; i < data.length; i++) {
                validateConfigs.push(this.settingService.validateObject(data[i], this.defaultValues, ['parserInputs']));
            }
            this.userConfigurations.next(validateConfigs);
        }).catch((error) => {
            this.loggerService.error(this.lang.error.readingConfiguration, { invokeAlert: true, alertTimeout: 5000 });
            this.loggerService.error(error);
        });
    }
}