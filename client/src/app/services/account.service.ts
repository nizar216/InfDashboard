import { Injectable } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of, EMPTY } from 'rxjs';
import { map, concatMap, finalize } from 'rxjs/operators';
import { TokenService } from 'src/app/services/token.service';
import { environment } from 'src/environments/environment';
import { Account } from 'src/app/modules/account';

const baseUrl = `${environment.apiUrl}`;

@Injectable({ providedIn: 'root' })
export class AccountService {
    private accountSubject: BehaviorSubject<Account>;
    public account: Observable<Account>;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private http: HttpClient,
        private tokenService:TokenService
    ) {
        this.accountSubject = new BehaviorSubject<Account>(null);
        this.account = this.accountSubject.asObservable();
    }

    public get accountValue(): Account {
        return this.accountSubject.value;
    }

    login() : Observable<any>{
        // login with facebook then authenticate with the API to get a JWT auth token
        this.facebookLogin()
            .pipe(concatMap(accessToken => this.apiAuthenticate(accessToken)))
            .subscribe((response) => {
              this.tokenService.SetToken(response.token);
              setTimeout(() => {
                this.router.navigate(['moments']);
              }, 2000);
            });
        return ;
    }

    facebookLogin() {
        // login with facebook and return observable with fb access token on success
        return from(new Promise<fb.StatusResponse>(resolve => FB.login(resolve, {scope: 'email,user_likes,pages_read_engagement,read_insights'})))
            .pipe(concatMap(({ authResponse }) => {
                if (!authResponse) return EMPTY;
                return of(authResponse.accessToken);
            }));
    }

    apiAuthenticate(accessToken: string) {
        // authenticate with the api using a facebook access token,
        // on success the api returns an account object with a JWT auth token
        return this.http.post<any>(`${baseUrl}/facebookLogin`, { accessToken });
    }

    logout() {
        // revoke app permissions to logout completely because FB.logout() doesn't remove FB cookie
        FB.api('/me/permissions', 'delete', null, () => FB.logout());
        this.stopAuthenticateTimer();
        this.accountSubject.next(null);
        this.router.navigate(['/login']);
    }

    getAll() {
        return this.http.get<Account[]>(baseUrl);
    }

    getById(id) {
        return this.http.get<Account>(`${baseUrl}/${id}`);
    }

    update(id, params) {
        return this.http.put(`${baseUrl}/${id}`, params)
            .pipe(map((account: any) => {
                // update the current account if it was updated
                if (account.id === this.accountValue.id) {
                    // publish updated account to subscribers
                    account = { ...this.accountValue, ...account };
                    this.accountSubject.next(account);
                }
                return account;
            }));
    }

    delete(id: string) {
        return this.http.delete(`${baseUrl}/${id}`)
            .pipe(finalize(() => {
                // auto logout if the logged in account was deleted
                if (id === this.accountValue.id)
                    this.logout();
            }));
    }

    // helper methods

    private authenticateTimeout;

    private startAuthenticateTimer() {
        // parse json object from base64 encoded jwt token
        const jwtToken = JSON.parse(atob(this.accountValue.token.split('.')[1]));

        // set a timeout to re-authenticate with the api one minute before the token expires
        const expires = new Date(jwtToken.exp * 1000);
        const timeout = expires.getTime() - Date.now() - (60 * 1000);
        const { accessToken } = FB.getAuthResponse();
        this.authenticateTimeout = setTimeout(() => {
            this.apiAuthenticate(accessToken).subscribe();
        }, timeout);
    }

    private stopAuthenticateTimer() {
        // cancel timer for re-authenticating with the api
        clearTimeout(this.authenticateTimeout);
    }
}
