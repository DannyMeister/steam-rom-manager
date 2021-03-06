import { Injectable } from '@angular/core';
import { Http } from '@angular/http';
import { BehaviorSubject, Subject } from 'rxjs';
import { ParsersService } from './parsers.service';
import { LoggerService } from './logger.service';
import { SettingsService } from './settings.service';
import { ImageProviderService } from './image-provider.service';
import { PreviewData, ImageContent, ParsedUserConfiguration, Images, PreviewVariables, ImagesStatusAndContent, ProviderCallbackEventMap, PreviewDataApp, AppSettings, SteamGridImageData } from '../models';
import { Reference, VdfManager, generateAppId } from "../lib";
import { gApp } from "../app.global";
import { queue } from 'async';
import * as _ from "lodash";
import * as fs from "fs-extra";
import * as path from "path";

@Injectable()
export class PreviewService {
    private appSettings: AppSettings;
    private previewData: PreviewData;
    private previewVariables: PreviewVariables;
    private previewDataChanged: Subject<boolean>;
    private images: Images;
    private allEditedSteamDirectories: string[];

    constructor(private parsersService: ParsersService, private loggerService: LoggerService, private imageProviderService: ImageProviderService, private settingsService: SettingsService, private http: Http) {
        this.previewData = undefined;
        this.previewVariables = {
            listIsBeingSaved: false,
            listIsBeingGenerated: false,
            listIsBeingRemoved: false,
            numberOfQueriedImages: 0,
            numberOfListItems: 0
        };
        this.previewDataChanged = new Subject<boolean>();
        this.settingsService.onLoad((appSettings: AppSettings) => {
            this.appSettings = appSettings;
        });
    }

    get lang() {
        return gApp.lang.preview.service;
    }

    getPreviewData() {
        return this.previewData;
    }

    getPreviewDataChange() {
        return this.previewDataChanged;
    }

    getPreviewVariables() {
        return this.previewVariables;
    }

    generatePreviewData() {
        if (this.previewVariables.listIsBeingGenerated)
            return this.loggerService.info(this.lang.info.listIsBeingGenerated, { invokeAlert: true, alertTimeout: 3000 });
        else if (this.previewVariables.listIsBeingSaved)
            return this.loggerService.info(this.lang.info.listIsBeingSaved, { invokeAlert: true, alertTimeout: 3000 });
        else if (this.previewVariables.listIsBeingRemoved)
            return this.loggerService.info(this.lang.info.listIsBeingRemoved, { invokeAlert: true, alertTimeout: 3000 });

        this.previewVariables.listIsBeingGenerated = true;
        this.imageProviderService.instance.stopUrlDownload();
        this.generatePreviewDataCallback();
    }

    saveData() {
        if (this.previewVariables.listIsBeingSaved)
            return this.loggerService.info(this.lang.info.listIsBeingSaved, { invokeAlert: true, alertTimeout: 3000 });
        else if (this.previewVariables.numberOfListItems === 0)
            return this.loggerService.info(this.lang.info.listIsEmpty, { invokeAlert: true, alertTimeout: 3000 });
        else if (this.previewVariables.listIsBeingRemoved)
            return this.loggerService.info(this.lang.info.listIsBeingRemoved, { invokeAlert: true, alertTimeout: 3000 });


        this.previewVariables.listIsBeingSaved = true;

        let vdfManager = new VdfManager(this.http);
        this.loggerService.info(this.lang.info.populatingVDF_List, { invokeAlert: true, alertTimeout: 3000 });
        vdfManager.populateListFromPreviewData(this.previewData).then(() => {
            this.loggerService.info(this.lang.info.creatingBackups, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.createBackups();
        }).then(() => {
            this.loggerService.info(this.lang.info.readingVDF_Files, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.readAllVDFs();
        }).then(() => {
            this.loggerService.info(this.lang.info.mergingVDF_entries, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.mergeVDFEntriesAndReplaceImages(this.previewData);
        }).then((errors) => {
            if (errors && errors.length) {
                this.loggerService.error(this.lang.errors.mergingVDF_entries);
                for (let i = 0; i < errors.length; i++)
                    this.loggerService.error(errors[i]);
            }
            this.loggerService.info(this.lang.info.writingVDF_entries, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.writeAllVDFs();
        }).then(() => {
            this.loggerService.success(this.lang.info.updatingKnownSteamDirList, { invokeAlert: true, alertTimeout: 3000 });
            let settings = this.settingsService.getSettings();
            settings.knownSteamDirectories = _.union(settings.knownSteamDirectories, Object.keys(this.previewData));
            this.settingsService.settingsChanged();
        }).then(() => {
            this.loggerService.success(this.lang.success.writingVDF_entries, { invokeAlert: true, alertTimeout: 3000 });
            this.previewVariables.listIsBeingSaved = false;
        }).catch((fatalError) => {
            this.loggerService.error(this.lang.errors.fatalError, { invokeAlert: true, alertTimeout: 3000 });
            this.loggerService.error(fatalError);
            this.previewVariables.listIsBeingSaved = false;
        });
    }

    remove(all: boolean) {
        if (this.previewVariables.listIsBeingSaved)
            return this.loggerService.info(this.lang.info.listIsBeingSaved, { invokeAlert: true, alertTimeout: 3000 });
        else if (this.previewVariables.numberOfListItems === 0 && !all)
            return this.loggerService.info(this.lang.info.listIsEmpty, { invokeAlert: true, alertTimeout: 3000 });
        else if (this.previewVariables.listIsBeingRemoved)
            return this.loggerService.info(this.lang.info.listIsBeingRemoved, { invokeAlert: true, alertTimeout: 3000 });
        else if (all && this.appSettings.knownSteamDirectories.length === 0)
            return this.loggerService.error(this.lang.errors.knownSteamDirListIsEmpty, { invokeAlert: true, alertTimeout: 3000 });

        this.imageProviderService.instance.stopUrlDownload();
        this.previewDataChanged.next();
        this.previewVariables.listIsBeingRemoved = true;

        let vdfManager = new VdfManager(this.http);
        this.loggerService.info(this.lang.info.populatingVDF_List, { invokeAlert: true, alertTimeout: 3000 });
        Promise.resolve().then(() => {
            if (all)
                return vdfManager.populateListFromDirectoryList(this.appSettings.knownSteamDirectories);
            else
                return vdfManager.populateListFromPreviewData(this.previewData).then(() => { return []; });
        }).then((errors) => {
            if (errors && errors.length) {
                this.loggerService.error(this.lang.errors.readingVDF_entries);
                for (let i = 0; i < errors.length; i++)
                    this.loggerService.error(errors[i]);
            }
            this.loggerService.info(this.lang.info.creatingBackups, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.createBackups();
        }).then(() => {
            this.loggerService.info(this.lang.info.readingVDF_Files, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.readAllVDFs();
        }).then(() => {
            this.loggerService.info(this.lang.info.removingVDF_entries, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.removeVDFEntriesAndImages(all ? undefined : this.previewData);
        }).then((errors) => {
            this.loggerService.info(this.lang.info.writingVDF_entries, { invokeAlert: true, alertTimeout: 3000 });
            return vdfManager.writeAllVDFs();
        }).then(() => {
            this.loggerService.success(this.lang.success.removingVDF_entries, { invokeAlert: true, alertTimeout: 3000 });
            this.previewVariables.listIsBeingRemoved = false;
        }).catch((fatalError) => {
            this.loggerService.error(this.lang.errors.fatalError, { invokeAlert: true, alertTimeout: 3000 });
            this.loggerService.error(fatalError);
            this.previewVariables.listIsBeingRemoved = false;
        });
    }

    loadImage(app: PreviewDataApp) {
        if (app) {
            let image = app.images.value.content[app.currentImageIndex];
            if (image && (image.loadStatus === 'notStarted' || image.loadStatus === 'failed')) {
                if (image.loadStatus === 'failed') {
                    this.loggerService.info(this.lang.info.retryingDownload__i.interpolate({
                        imageUrl: image.imageUrl,
                        appTitle: app.title
                    }));
                }

                image.loadStatus = 'downloading';
                this.previewDataChanged.next();

                let imageLoader = new Image();
                imageLoader.onload = () => {
                    image.loadStatus = 'done';
                    this.previewDataChanged.next();
                };
                imageLoader.onerror = () => {
                    this.loggerService.error(this.lang.errors.retryingDownload__i.interpolate({
                        imageUrl: image.imageUrl,
                        appTitle: app.title
                    }));
                    image.loadStatus = 'failed';
                    this.previewDataChanged.next();
                };
                imageLoader.src = image.imageUrl;
            }
        }
    }

    preloadImages() {
        for (let imageKey in this.images) {
            for (let i = 0; i < this.images[imageKey].content.length; i++) {
                this.preloadImage(this.images[imageKey].content[i]);
            }
        }
    }

    preloadImage(image: ImageContent) {
        if (image && image.loadStatus === 'notStarted' || image.loadStatus === 'failed') {
            image.loadStatus = 'downloading';
            this.previewDataChanged.next();

            let imageLoader = new Image();
            imageLoader.onload = () => {
                image.loadStatus = 'done';
                this.previewDataChanged.next();
            };
            imageLoader.onerror = () => {
                image.loadStatus = 'failed';
                this.previewDataChanged.next();
            };
            imageLoader.src = image.imageUrl;
        }
    }

    setImageIndex(app: PreviewDataApp, index: number) {
        if (app) {
            let images = app.images.value.content;
            if (images.length) {
                let minIndex = app.steamImage ? -1 : 0;
                app.currentImageIndex = index < minIndex ? images.length - 1 : (index < images.length ? index : minIndex);
                this.previewDataChanged.next();
            }
        }
    }

    private generatePreviewDataCallback() {
        if (this.previewVariables.numberOfQueriedImages !== 0) {
            setTimeout(this.generatePreviewDataCallback.bind(this), 100);
        }
        else {
            this.previewData = undefined;
            this.loggerService.info(this.lang.info.executingParsers, { invokeAlert: true });
            this.parsersService.executeFileParser().then((data) => {
                if (data.skipped.length > 0) {
                    this.loggerService.info(this.lang.info.disabledConfigurations__i.interpolate({
                        count: data.skipped.length
                    }), { invokeAlert: true, alertTimeout: 3000 });
                    for (let i = 0; i < data.skipped.length; i++) {
                        this.loggerService.info(data.skipped[i]);
                    }
                }

                if (data.invalid.length > 0) {
                    this.loggerService.info(this.lang.info.invalidConfigurations__i.interpolate({
                        count: data.invalid.length
                    }), { invokeAlert: true, alertTimeout: 3000 });
                    for (let i = 0; i < data.invalid.length; i++) {
                        this.loggerService.info(data.invalid[i]);
                    }
                }

                if (data.parsedData.length > 0) {
                    this.loggerService.info(this.lang.info.shutdownSteam, { invokeAlert: true, alertTimeout: 3000 });
                    this.images = {};
                    return this.createPreviewData(data.parsedData);
                }
                else if (data.invalid.length === 0 && data.skipped.length === 0) {
                    if (this.parsersService.getUserConfigurationsArray().length === 0)
                        this.loggerService.info(this.lang.info.noParserConfigurations, { invokeAlert: true, alertTimeout: 3000 });
                    else
                        this.loggerService.info(this.lang.info.parserFoundNoFiles, { invokeAlert: true, alertTimeout: 3000 });
                }
            }).then((previewData) => {
                if (previewData && previewData.numberOfItems > 0) {
                    this.previewData = previewData.data;
                    this.previewVariables.numberOfListItems = previewData.numberOfItems;
                    this.downloadImageUrls();
                }
                else {
                    this.previewVariables.numberOfListItems = 0;
                }

                this.previewVariables.listIsBeingGenerated = false;
                this.previewDataChanged.next();
            }).catch((error) => {
                this.loggerService.error(this.lang.errors.fatalError, { invokeAlert: true, alertTimeout: 3000 });
                this.loggerService.error(error);
                this.previewVariables.listIsBeingGenerated = false;
                this.previewDataChanged.next();
            });
        }
    }

    private getNonSteamGridData(data: ParsedUserConfiguration[]) {
        return new Promise<SteamGridImageData>((resolve, reject) => {
            let numberOfItems: number = 0;
            let fileData: SteamGridImageData = {};

            for (let i = 0; i < data.length; i++) {
                let config = data[i];

                if (fileData[config.steamDirectory] === undefined)
                    fileData[config.steamDirectory] = {};

                for (let j = 0; j < config.foundUserAccounts.length; j++) {
                    let userAccount = config.foundUserAccounts[j];

                    if (fileData[config.steamDirectory][userAccount.accountID] === undefined) {
                        numberOfItems++;
                        fileData[config.steamDirectory][userAccount.accountID] = {};
                    }
                }
            }

            if (numberOfItems === 0)
                resolve(fileData);
            else {
                let promises: Promise<void>[] = [];
                for (let steamDirectory in fileData) {
                    for (let userId in fileData[steamDirectory]) {
                        promises.push(new Promise<void>((innerResolve, innerReject) => {
                            fs.readdir(path.join(steamDirectory, 'userdata', userId, 'config', 'grid'), (error, files) => {
                                if (error) {
                                    if (error.code === 'ENOENT')
                                        innerResolve();
                                    else
                                        innerReject(error);
                                }
                                else {
                                    let extRegex = /png|tga|jpg|jpeg/i;
                                    for (let i = 0; i < files.length; i++) {
                                        let ext = path.extname(files[i]);
                                        let basename = path.basename(files[i], ext);
                                        if (fileData[steamDirectory][userId][basename] === undefined) {
                                            if (extRegex.test(ext))
                                                fileData[steamDirectory][userId][basename] = path.join(steamDirectory, 'userdata', userId, 'config', 'grid', files[i]);
                                        }
                                    }
                                    innerResolve();
                                }
                            });
                        }));
                    }
                }
                Promise.all(promises).then(() => resolve(fileData)).catch((errors) => reject(errors));
            }
        });
    }

    private createPreviewData(data: ParsedUserConfiguration[]) {
        return Promise.resolve().then(() => {
            return this.getNonSteamGridData(data);
        }).then((gridData) => {
            let numberOfItems: number = 0;
            let previewData: PreviewData = {};

            for (let i = 0; i < data.length; i++) {
                let config = data[i];

                if (previewData[config.steamDirectory] === undefined)
                    previewData[config.steamDirectory] = {};

                for (let j = 0; j < config.foundUserAccounts.length; j++) {
                    let userAccount = config.foundUserAccounts[j];

                    if (previewData[config.steamDirectory][userAccount.accountID] === undefined) {
                        previewData[config.steamDirectory][userAccount.accountID] = {
                            username: userAccount.name,
                            apps: {}
                        };
                    }

                    for (let k = 0; k < data[i].files.length; k++) {
                        let file = config.files[k];
                        let appID = generateAppId(file.executableLocation, file.fuzzyFinalTitle);

                        if (this.images[file.fuzzyTitle] === undefined) {
                            this.images[file.fuzzyTitle] = {
                                retrieving: false,
                                searchQueries: file.onlineImageQueries,
                                defaultImageProviders: config.imageProviders,
                                content: []
                            };
                        }
                        else {
                            let currentQueries = this.images[file.fuzzyTitle].searchQueries;
                            let currentProviders = this.images[file.fuzzyTitle].defaultImageProviders;

                            this.images[file.fuzzyTitle].searchQueries = _.union(currentQueries, file.onlineImageQueries);
                            this.images[file.fuzzyTitle].defaultImageProviders = _.union(currentProviders, config.imageProviders);
                        }

                        if (previewData[config.steamDirectory][userAccount.accountID].apps[appID] === undefined) {
                            let steamImage = gridData[config.steamDirectory][userAccount.accountID][appID];
                            let steamImageUrl = steamImage ? encodeURI('file:///' + steamImage.replace(/\\/g, '/')) : undefined;

                            numberOfItems++;
                            previewData[config.steamDirectory][userAccount.accountID].apps[appID] = {
                                steamCategories: config.steamCategories,
                                imageProviders: config.imageProviders,
                                argumentString: file.argumentString,
                                title: file.fuzzyFinalTitle,
                                steamImage: steamImage ? {
                                    imageProvider: 'Steam',
                                    imageUrl: steamImageUrl,
                                    loadStatus: 'done'
                                } : undefined,
                                currentImageIndex: steamImageUrl ? -1 : 0,
                                executableLocation: file.executableLocation,
                                images: new Reference<ImagesStatusAndContent>(this.images, file.fuzzyTitle)
                            };
                        }
                        else {
                            let currentCategories = previewData[config.steamDirectory][userAccount.accountID].apps[appID].steamCategories;
                            previewData[config.steamDirectory][userAccount.accountID].apps[appID].steamCategories = _.union(currentCategories, config.steamCategories);
                        }

                        for (let l = 0; l < file.localImages.length; l++) {
                            this.addUniqueImage(file.fuzzyTitle, {
                                imageProvider: 'LocalStorage',
                                imageUrl: file.localImages[l],
                                loadStatus: 'done'
                            });
                        }
                    }
                }
            }
            return { numberOfItems: numberOfItems, data: previewData };
        });
    }

    downloadImageUrls(imageKeys?: string[], imageProviders?: string[]) {
        if (!this.appSettings.offlineMode) {
            let allImagesRetrieved = true;
            let imageQueue = queue((task, callback) => callback());

            if (imageKeys === undefined || imageKeys.length === 0) {
                imageKeys = Object.keys(this.images);
            }

            for (let i = 0; i < imageKeys.length; i++) {
                let image = this.images[imageKeys[i]];
                let imageProvidersForKey: string[] = imageProviders === undefined || imageProviders.length === 0 ? image.defaultImageProviders : imageProviders;

                imageProvidersForKey = _.intersection(this.appSettings.enabledProviders, imageProvidersForKey);

                if (image !== undefined && !image.retrieving) {
                    let numberOfQueriesForImageKey = image.searchQueries.length * imageProvidersForKey.length;

                    if (numberOfQueriesForImageKey > 0) {
                        image.retrieving = true;
                        allImagesRetrieved = false;
                        this.previewVariables.numberOfQueriedImages += numberOfQueriesForImageKey;

                        for (let j = 0; j < image.searchQueries.length; j++) {
                            this.imageProviderService.instance.retrieveUrls(image.searchQueries[j], imageProvidersForKey, <K extends keyof ProviderCallbackEventMap>(event: K, data: ProviderCallbackEventMap[K]) => {
                                switch (event) {
                                    case 'error':
                                        {
                                            let errorData = (data as ProviderCallbackEventMap['error']);
                                            if (typeof errorData.error === 'number') {
                                                this.loggerService.error(this.lang.errors.providerError__i.interpolate({
                                                    provider: errorData.provider,
                                                    code: errorData.error,
                                                    title: errorData.title,
                                                    url: errorData.url
                                                }));
                                            }
                                            else {
                                                this.loggerService.error(this.lang.errors.unknownProviderError__i.interpolate({
                                                    provider: errorData.provider,
                                                    title: errorData.title,
                                                    error: errorData.error
                                                }));
                                            }
                                        }

                                        break;
                                    case 'timeout':
                                        {
                                            let timeoutData = (data as ProviderCallbackEventMap['timeout']);
                                            this.loggerService.info(this.lang.info.providerTimeout__i.interpolate({
                                                time: timeoutData.time,
                                                provider: timeoutData.provider
                                            }), { invokeAlert: true, alertTimeout: 3000 });
                                        }
                                        break;
                                    case 'image':
                                        imageQueue.push(null, () => {
                                            let newImage = this.addUniqueImage(imageKeys[i], (data as ProviderCallbackEventMap['image']).content);
                                            if (newImage !== null && this.appSettings.previewSettings.preload)
                                                this.preloadImage(newImage);

                                            this.previewDataChanged.next();
                                        });
                                        break;
                                    case 'completed':
                                        {
                                            if (--numberOfQueriesForImageKey === 0) {
                                                image.retrieving = false;
                                            }
                                            if (--this.previewVariables.numberOfQueriedImages === 0) {
                                                this.loggerService.info(this.lang.info.allImagesRetrieved, { invokeAlert: true, alertTimeout: 3000 });
                                            }
                                            this.previewDataChanged.next();
                                        }
                                        break;
                                    default:
                                        break;
                                }
                            });
                        }
                    }
                }
            }
            this.previewDataChanged.next();
            if (allImagesRetrieved) {
                this.loggerService.info(this.lang.info.allImagesRetrieved, { invokeAlert: true, alertTimeout: 3000 });
            }
        }
        else
            this.previewDataChanged.next();
    }

    private addUniqueImage(imageKey: string, content: ImageContent) {
        if (this.images[imageKey].content.findIndex((item) => item.imageUrl === content.imageUrl) === -1) {
            this.images[imageKey].content.push(content);
            return this.images[imageKey].content[this.images[imageKey].content.length - 1];
        }
        return null;
    }
}