export namespace ssh {
	
	export class ConnectRequest {
	    host: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    password: string;
	    privateKeyPath: string;
	    passphrase: string;
	    cols: number;
	    rows: number;
	    savedId: string;
	    startupCommand: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.password = source["password"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.passphrase = source["passphrase"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	        this.savedId = source["savedId"];
	        this.startupCommand = source["startupCommand"];
	    }
	}
	export class FileEntry {
	    name: string;
	    size: number;
	    modified: string;
	    isDir: boolean;
	    owner: string;
	    permissions: string;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.modified = source["modified"];
	        this.isDir = source["isDir"];
	        this.owner = source["owner"];
	        this.permissions = source["permissions"];
	    }
	}
	export class Directory {
	    path: string;
	    entries: FileEntry[];
	    ownerWarning: string;
	
	    static createFrom(source: any = {}) {
	        return new Directory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.entries = this.convertValues(source["entries"], FileEntry);
	        this.ownerWarning = source["ownerWarning"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Login {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    privateKeyPath: string;
	    startupCommand: string;
	    hasSecret: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Login(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.startupCommand = source["startupCommand"];
	        this.hasSecret = source["hasSecret"];
	    }
	}
	export class SaveLoginRequest {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    privateKeyPath: string;
	    startupCommand: string;
	    hasSecret: boolean;
	    secret: string;
	    saveSecret: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveLoginRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.startupCommand = source["startupCommand"];
	        this.hasSecret = source["hasSecret"];
	        this.secret = source["secret"];
	        this.saveSecret = source["saveSecret"];
	    }
	}
	export class TextChunk {
	    text: string;
	    offset: number;
	    nextOffset: number;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new TextChunk(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.offset = source["offset"];
	        this.nextOffset = source["nextOffset"];
	        this.size = source["size"];
	    }
	}

}

export namespace vnc {
	
	export class Crop {
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new Crop(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class Login {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    hasSecret: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Login(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.hasSecret = source["hasSecret"];
	    }
	}
	export class SaveLoginRequest {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    secret: string;
	    saveSecret: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveLoginRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.secret = source["secret"];
	        this.saveSecret = source["saveSecret"];
	    }
	}
	export class Tunnel {
	    id: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new Tunnel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.url = source["url"];
	    }
	}

}

