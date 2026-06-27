import { ServerRole } from '../../../server/services/DynamoDBInterfaces';
import { checkServerRoleUserPrivileges } from '../../../server/utils/authUtils';

describe('authUtils', function () {
    it('fails without throwing when server role cache is unavailable', function () {
        const result = checkServerRoleUserPrivileges('/api/cosmetics', 'anonymous-user', ServerRole.Contributor, undefined);

        expect(result).toEqual({
            success: false,
            message: 'Role cache unavailable'
        });
    });
});
