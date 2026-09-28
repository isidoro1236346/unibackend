const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DispositivoPush = sequelize.define(
    'DispositivoPush',
    {
      iddispositivo: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      idusuario: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'idusuario',
        references: { model: 'usuario', key: 'idusuario' },
      },
      // Endpoint del navegador. Es único porque una misma suscripción solo
      // puede pertenecer a un usuario: si otro la reclama, se actualiza el
      // idusuario en vez de crear un duplicado.
      endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      p256dh: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      auth: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      user_agent: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // El browser puede Renewable las claves y devolver un endpoint distinto
      // para la misma suscripción; se guardan los dos casos.
      expiracion: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ultimo_envio: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      fallidos_consecutivos: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'dispositivo_push',
      timestamps: true,
      underscored: true,
    }
  );

  DispositivoPush.associate = function (models) {
    DispositivoPush.belongsTo(models.User, {
      foreignKey: 'idusuario',
      as: 'usuario',
    });
  };

  return DispositivoPush;
};
