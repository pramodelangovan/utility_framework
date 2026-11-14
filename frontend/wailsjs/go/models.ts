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

